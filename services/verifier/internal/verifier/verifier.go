package verifier

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var (
	ErrChallengeExpired = errors.New("verification challenge expired")
	ErrChallengeMissing = errors.New("verification challenge not found")
	ErrChallengeUsed    = errors.New("verification challenge already used")
	ErrDNSProofMissing  = errors.New("required DNS TXT value was not found")
)

const (
	challengeTTL        = 15 * time.Minute
	attestationValidity = 30 * 24 * time.Hour
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
	mu         sync.Mutex
	challenges map[string]*Challenge
	resolver   TXTResolver
	signer     AttestationSigner
	now        func() time.Time
}

func NewManager(resolver TXTResolver, signer AttestationSigner) *Manager {
	return &Manager{
		challenges: make(map[string]*Challenge),
		resolver:   resolver,
		signer:     signer,
		now:        time.Now,
	}
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
	m.challenges[id] = challenge
	m.mu.Unlock()
	return *challenge, nil
}

func (m *Manager) Verify(ctx context.Context, id string) (Attestation, error) {
	now := m.now().UTC()
	m.mu.Lock()
	challenge, ok := m.challenges[id]
	if !ok {
		m.mu.Unlock()
		return Attestation{}, ErrChallengeMissing
	}
	if !now.Before(challenge.ExpiresAt) {
		delete(m.challenges, id)
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
