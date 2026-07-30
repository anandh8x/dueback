package verifier

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrChallengeExpired = errors.New("verification challenge expired")
	ErrChallengeMissing = errors.New("verification challenge not found")
	ErrChallengeUsed    = errors.New("verification challenge already used")
	ErrDNSProofMissing  = errors.New("required DNS TXT value was not found")
	ErrChallengeLimit   = errors.New("verification challenge capacity reached")
)

const (
	challengeTTL         = 15 * time.Minute
	attestationValidity  = 30 * 24 * time.Hour
	defaultMaxChallenges = 10_000
	defaultVerifyTimeout = 20 * time.Second
)

type TXTResolver interface {
	LookupTXT(context.Context, string) ([]string, error)
}

type AttestationSigner interface {
	Sign(context.Context, AttestationRequest) (Attestation, error)
}

type AttestationRequest struct {
	Domain     string
	Admin      string
	ValidUntil time.Time
	Nonce      string
}

type Attestation struct {
	OrganizationID string    `json:"organizationId"`
	Admin          string    `json:"admin"`
	ValidUntil     time.Time `json:"validUntil"`
	Nonce          string    `json:"nonce"`
	Signature      string    `json:"signature"`
}

type Challenge struct {
	ID        string    `json:"id"`
	Domain    string    `json:"domain"`
	Admin     string    `json:"admin"`
	DNSName   string    `json:"dnsName"`
	DNSValue  string    `json:"dnsValue"`
	ExpiresAt time.Time `json:"expiresAt"`

	nonce     string
	used      bool
	verifying bool
}

type Manager struct {
	mu            sync.Mutex
	challenges    map[string]*Challenge
	resolver      TXTResolver
	signer        AttestationSigner
	now           func() time.Time
	maxChallenges int
	verifyTimeout time.Duration
	storePath     string
}

func NewManager(resolver TXTResolver, signer AttestationSigner) *Manager {
	manager, err := NewManagerWithOptions(resolver, signer, Options{})
	if err != nil {
		panic(err)
	}
	return manager
}

type Options struct {
	MaxChallenges int
	VerifyTimeout time.Duration
	StorePath     string
}

func NewManagerWithOptions(resolver TXTResolver, signer AttestationSigner, options Options) (*Manager, error) {
	if options.MaxChallenges <= 0 {
		options.MaxChallenges = defaultMaxChallenges
	}
	if options.VerifyTimeout <= 0 {
		options.VerifyTimeout = defaultVerifyTimeout
	}
	manager := &Manager{
		challenges:    make(map[string]*Challenge),
		resolver:      resolver,
		signer:        signer,
		now:           time.Now,
		maxChallenges: options.MaxChallenges,
		verifyTimeout: options.VerifyTimeout,
		storePath:     strings.TrimSpace(options.StorePath),
	}
	if err := manager.load(); err != nil {
		return nil, err
	}
	return manager, nil
}

func (m *Manager) Create(domain, admin string) (Challenge, error) {
	normalizedDomain, err := NormalizeDomain(domain)
	if err != nil {
		return Challenge{}, err
	}
	normalizedAdmin, err := NormalizeAddress(admin)
	if err != nil {
		return Challenge{}, err
	}
	id, err := randomHex(16)
	if err != nil {
		return Challenge{}, fmt.Errorf("create challenge id: %w", err)
	}
	token, err := randomHex(32)
	if err != nil {
		return Challenge{}, fmt.Errorf("create challenge token: %w", err)
	}
	nonce, err := randomHex(32)
	if err != nil {
		return Challenge{}, fmt.Errorf("create attestation nonce: %w", err)
	}
	now := m.now().UTC()
	challenge := &Challenge{
		ID:        id,
		Domain:    normalizedDomain,
		Admin:     normalizedAdmin,
		DNSName:   "_dueback." + normalizedDomain,
		DNSValue:  "dueback-verification=" + token[2:],
		ExpiresAt: now.Add(challengeTTL),
		nonce:     nonce,
	}
	m.mu.Lock()
	m.removeExpiredLocked(now)
	if len(m.challenges) >= m.maxChallenges {
		m.mu.Unlock()
		return Challenge{}, ErrChallengeLimit
	}
	m.challenges[id] = challenge
	if err := m.persistLocked(); err != nil {
		delete(m.challenges, id)
		m.mu.Unlock()
		return Challenge{}, fmt.Errorf("persist challenge: %w", err)
	}
	m.mu.Unlock()
	return *challenge, nil
}

func (m *Manager) Verify(ctx context.Context, id string) (Attestation, error) {
	ctx, cancel := context.WithTimeout(ctx, m.verifyTimeout)
	defer cancel()
	now := m.now().UTC()
	m.mu.Lock()
	challenge, ok := m.challenges[id]
	if !ok {
		m.mu.Unlock()
		return Attestation{}, ErrChallengeMissing
	}
	if !now.Before(challenge.ExpiresAt) {
		delete(m.challenges, id)
		_ = m.persistLocked()
		m.mu.Unlock()
		return Attestation{}, ErrChallengeExpired
	}
	if challenge.used || challenge.verifying {
		m.mu.Unlock()
		return Attestation{}, ErrChallengeUsed
	}
	challenge.verifying = true
	snapshot := *challenge
	m.mu.Unlock()

	txt, err := m.resolver.LookupTXT(ctx, snapshot.DNSName)
	if err != nil {
		m.release(id)
		return Attestation{}, fmt.Errorf("lookup DNS TXT: %w", err)
	}
	found := false
	for _, value := range txt {
		if strings.TrimSpace(value) == snapshot.DNSValue {
			found = true
			break
		}
	}
	if !found {
		m.release(id)
		return Attestation{}, ErrDNSProofMissing
	}

	attestation, err := m.signer.Sign(ctx, AttestationRequest{
		Domain:     snapshot.Domain,
		Admin:      snapshot.Admin,
		ValidUntil: now.Add(attestationValidity),
		Nonce:      snapshot.nonce,
	})
	if err != nil {
		m.release(id)
		return Attestation{}, fmt.Errorf("sign domain attestation: %w", err)
	}

	m.mu.Lock()
	challenge.used = true
	challenge.verifying = false
	if err := m.persistLocked(); err != nil {
		m.mu.Unlock()
		return Attestation{}, fmt.Errorf("persist consumed challenge: %w", err)
	}
	m.mu.Unlock()
	return attestation, nil
}

func (m *Manager) release(id string) {
	m.mu.Lock()
	if challenge := m.challenges[id]; challenge != nil {
		challenge.verifying = false
	}
	m.mu.Unlock()
}

func (m *Manager) removeExpiredLocked(now time.Time) {
	for id, challenge := range m.challenges {
		if !now.Before(challenge.ExpiresAt) {
			delete(m.challenges, id)
		}
	}
}

type storedChallenge struct {
	ID        string    `json:"id"`
	Domain    string    `json:"domain"`
	Admin     string    `json:"admin"`
	DNSName   string    `json:"dnsName"`
	DNSValue  string    `json:"dnsValue"`
	ExpiresAt time.Time `json:"expiresAt"`
	Nonce     string    `json:"nonce"`
	Used      bool      `json:"used"`
}

func (m *Manager) load() error {
	if m.storePath == "" {
		return nil
	}
	content, err := os.ReadFile(m.storePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read challenge store: %w", err)
	}
	var stored []storedChallenge
	if err := json.Unmarshal(content, &stored); err != nil {
		return fmt.Errorf("decode challenge store: %w", err)
	}
	now := m.now().UTC()
	for _, item := range stored {
		if now.Before(item.ExpiresAt) {
			if len(m.challenges) >= m.maxChallenges {
				return ErrChallengeLimit
			}
			m.challenges[item.ID] = &Challenge{
				ID: item.ID, Domain: item.Domain, Admin: item.Admin, DNSName: item.DNSName,
				DNSValue: item.DNSValue, ExpiresAt: item.ExpiresAt, nonce: item.Nonce, used: item.Used,
			}
		}
	}
	return nil
}

func (m *Manager) persistLocked() error {
	if m.storePath == "" {
		return nil
	}
	stored := make([]storedChallenge, 0, len(m.challenges))
	for _, challenge := range m.challenges {
		stored = append(stored, storedChallenge{
			ID: challenge.ID, Domain: challenge.Domain, Admin: challenge.Admin,
			DNSName: challenge.DNSName, DNSValue: challenge.DNSValue, ExpiresAt: challenge.ExpiresAt,
			Nonce: challenge.nonce, Used: challenge.used,
		})
	}
	content, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(m.storePath), 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(m.storePath), ".challenges-*")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(content); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempName, m.storePath)
}

func NormalizeDomain(value string) (string, error) {
	domain := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
	if len(domain) < 3 || len(domain) > 253 {
		return "", errors.New("domain must be between 3 and 253 characters")
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return "", errors.New("domain must contain at least two labels")
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", errors.New("domain contains an invalid label")
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') &&
				(character < '0' || character > '9') &&
				character != '-' {
				return "", errors.New("domain contains unsupported characters")
			}
		}
	}
	return domain, nil
}

func NormalizeAddress(value string) (string, error) {
	address := strings.TrimSpace(value)
	if len(address) != 42 || !strings.HasPrefix(address, "0x") {
		return "", errors.New("admin must be a 20-byte EVM address")
	}
	if _, err := hex.DecodeString(address[2:]); err != nil {
		return "", errors.New("admin must be a hexadecimal EVM address")
	}
	return address, nil
}

func randomHex(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "0x" + hex.EncodeToString(value), nil
}
