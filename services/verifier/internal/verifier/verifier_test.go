package verifier

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

type fakeResolver struct {
	values map[string][]string
	err    error
}

func (f *fakeResolver) LookupTXT(_ context.Context, name string) ([]string, error) {
	return f.values[name], f.err
}

type fakeSigner struct {
	calls int
}

func (f *fakeSigner) Sign(_ context.Context, request AttestationRequest) (Attestation, error) {
	f.calls++
	return Attestation{
		OrganizationID: "0xorganization",
		Admin:          request.Admin,
		ValidUntil:     request.ValidUntil,
		Nonce:          request.Nonce,
		Signature:      "0xsignature",
	}, nil
}

func TestCreateNormalizesAndScopesChallenge(t *testing.T) {
	manager := NewManager(&fakeResolver{}, &fakeSigner{})
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }

	challenge, err := manager.Create(
		" Refunds.Example. ",
		"0x99066fBc97557490fA794F750630bb41733D1004",
	)
	if err != nil {
		t.Fatal(err)
	}
	if challenge.Domain != "refunds.example" {
		t.Fatalf("unexpected domain %q", challenge.Domain)
	}
	if challenge.DNSName != "_dueback.refunds.example" {
		t.Fatalf("unexpected DNS name %q", challenge.DNSName)
	}
	if challenge.DNSValue == "" || challenge.ID == "" {
		t.Fatal("challenge secrets are missing")
	}
	if !challenge.ExpiresAt.Equal(now.Add(15 * time.Minute)) {
		t.Fatalf("unexpected expiry %v", challenge.ExpiresAt)
	}
}

func TestVerifyRequiresDNSAndConsumesChallenge(t *testing.T) {
	resolver := &fakeResolver{values: make(map[string][]string)}
	signer := &fakeSigner{}
	manager := NewManager(resolver, signer)
	challenge, err := manager.Create(
		"refunds.example",
		"0x99066fBc97557490fA794F750630bb41733D1004",
	)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := manager.Verify(context.Background(), challenge.ID); !errors.Is(err, ErrDNSProofMissing) {
		t.Fatalf("expected missing proof, received %v", err)
	}
	resolver.values[challenge.DNSName] = []string{"other", challenge.DNSValue}
	attestation, err := manager.Verify(context.Background(), challenge.ID)
	if err != nil {
		t.Fatal(err)
	}
	if attestation.Admin != challenge.Admin || signer.calls != 1 {
		t.Fatal("attestation was not signed for the challenge admin")
	}
	if _, err := manager.Verify(context.Background(), challenge.ID); !errors.Is(err, ErrChallengeUsed) {
		t.Fatalf("expected consumed challenge, received %v", err)
	}
}

func TestVerifyRejectsExpiredChallenge(t *testing.T) {
	manager := NewManager(&fakeResolver{}, &fakeSigner{})
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	manager.now = func() time.Time { return now }
	challenge, err := manager.Create(
		"refunds.example",
		"0x99066fBc97557490fA794F750630bb41733D1004",
	)
	if err != nil {
		t.Fatal(err)
	}
	manager.now = func() time.Time { return now.Add(16 * time.Minute) }

	if _, err := manager.Verify(context.Background(), challenge.ID); !errors.Is(err, ErrChallengeExpired) {
		t.Fatalf("expected expiry, received %v", err)
	}
}

func TestManagerEnforcesCapacity(t *testing.T) {
	manager, err := NewManagerWithOptions(&fakeResolver{}, &fakeSigner{}, Options{MaxChallenges: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Create("one.example", "0x99066fBc97557490fA794F750630bb41733D1004"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Create("two.example", "0x99066fBc97557490fA794F750630bb41733D1004"); !errors.Is(err, ErrChallengeLimit) {
		t.Fatalf("expected capacity error, received %v", err)
	}
}

func TestManagerPersistsReplayProtection(t *testing.T) {
	storePath := t.TempDir() + "/challenges.json"
	resolver := &fakeResolver{values: make(map[string][]string)}
	signer := &fakeSigner{}
	manager, err := NewManagerWithOptions(resolver, signer, Options{StorePath: storePath})
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := manager.Create("refunds.example", "0x99066fBc97557490fA794F750630bb41733D1004")
	if err != nil {
		t.Fatal(err)
	}
	resolver.values[challenge.DNSName] = []string{challenge.DNSValue}
	if _, err := manager.Verify(context.Background(), challenge.ID); err != nil {
		t.Fatal(err)
	}

	restarted, err := NewManagerWithOptions(resolver, signer, Options{StorePath: storePath})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Verify(context.Background(), challenge.ID); !errors.Is(err, ErrChallengeUsed) {
		t.Fatalf("expected persisted replay protection, received %v", err)
	}
	info, err := os.Stat(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("challenge store mode is %o", info.Mode().Perm())
	}
}

func TestNormalizeRejectsInvalidInputs(t *testing.T) {
	for _, domain := range []string{"localhost", "-bad.example", "bad_.example", "a..example"} {
		if _, err := NormalizeDomain(domain); err == nil {
			t.Fatalf("accepted invalid domain %q", domain)
		}
	}
	for _, address := range []string{"", "0x1234", "0xzz066fBc97557490fA794F750630bb41733D1004"} {
		if _, err := NormalizeAddress(address); err == nil {
			t.Fatalf("accepted invalid address %q", address)
		}
	}
}
