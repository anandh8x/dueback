package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/anandh8x/dueback/services/verifier/internal/verifier"
)

type resolverStub struct {
	values map[string][]string
}

func (r *resolverStub) LookupTXT(_ context.Context, name string) ([]string, error) {
	return r.values[name], nil
}

type signerStub struct{}

func (signerStub) Sign(_ context.Context, request verifier.AttestationRequest) (verifier.Attestation, error) {
	return verifier.Attestation{
		OrganizationID: "0xorganization",
		Admin:          request.Admin,
		ValidUntil:     request.ValidUntil,
		Nonce:          request.Nonce,
		Signature:      "0xsignature",
	}, nil
}

func TestHealthAndSecurityHeaders(t *testing.T) {
	handler := newTestHandler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", response.Code)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store header")
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff header")
	}
}

func TestCORSAllowsOnlyConfiguredOrigin(t *testing.T) {
	handler := AllowOrigin(newTestHandler(), "https://dueback.example")

	allowed := httptest.NewRecorder()
	allowedRequest := httptest.NewRequest(http.MethodOptions, "/v1/challenges", nil)
	allowedRequest.Header.Set("Origin", "https://dueback.example")
	handler.ServeHTTP(allowed, allowedRequest)
	if allowed.Code != http.StatusNoContent ||
		allowed.Header().Get("Access-Control-Allow-Origin") != "https://dueback.example" {
		t.Fatal("configured origin was not allowed")
	}

	rejected := httptest.NewRecorder()
	rejectedRequest := httptest.NewRequest(http.MethodOptions, "/v1/challenges", nil)
	rejectedRequest.Header.Set("Origin", "https://attacker.example")
	handler.ServeHTTP(rejected, rejectedRequest)
	if rejected.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unconfigured origin was allowed")
	}
}

func TestChallengeLifecycle(t *testing.T) {
	resolver := &resolverStub{values: make(map[string][]string)}
	manager := verifier.NewManager(resolver, signerStub{})
	handler := NewHandler(manager)

	body := []byte(`{"domain":"refunds.example","admin":"0x99066fBc97557490fA794F750630bb41733D1004"}`)
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(
		createResponse,
		httptest.NewRequest(http.MethodPost, "/v1/challenges", bytes.NewReader(body)),
	)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("unexpected create status %d: %s", createResponse.Code, createResponse.Body.String())
	}
	var challenge verifier.Challenge
	if err := json.Unmarshal(createResponse.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	if challenge.DNSValue == "" || challenge.ID == "" {
		t.Fatal("challenge response is incomplete")
	}

	missingResponse := httptest.NewRecorder()
	handler.ServeHTTP(
		missingResponse,
		httptest.NewRequest(http.MethodPost, "/v1/challenges/"+challenge.ID+"/verify", nil),
	)
	if missingResponse.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unexpected missing-proof status %d", missingResponse.Code)
	}

	resolver.values[challenge.DNSName] = []string{challenge.DNSValue}
	verifyResponse := httptest.NewRecorder()
	handler.ServeHTTP(
		verifyResponse,
		httptest.NewRequest(http.MethodPost, "/v1/challenges/"+challenge.ID+"/verify", nil),
	)
	if verifyResponse.Code != http.StatusOK {
		t.Fatalf("unexpected verify status %d: %s", verifyResponse.Code, verifyResponse.Body.String())
	}

	replayResponse := httptest.NewRecorder()
	handler.ServeHTTP(
		replayResponse,
		httptest.NewRequest(http.MethodPost, "/v1/challenges/"+challenge.ID+"/verify", nil),
	)
	if replayResponse.Code != http.StatusConflict {
		t.Fatalf("unexpected replay status %d", replayResponse.Code)
	}
}

func TestCreateRejectsUnknownAndInvalidFields(t *testing.T) {
	handler := newTestHandler()
	for _, body := range []string{
		`{"domain":"refunds.example","admin":"0x99066fBc97557490fA794F750630bb41733D1004","role":"admin"}`,
		`{"domain":"localhost","admin":"0x99066fBc97557490fA794F750630bb41733D1004"}`,
		`{`,
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(
			response,
			httptest.NewRequest(http.MethodPost, "/v1/challenges", bytes.NewBufferString(body)),
		)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("accepted invalid body %q with status %d", body, response.Code)
		}
	}
}

func TestCreateRateLimit(t *testing.T) {
	handler := NewHandlerWithRateLimit(
		verifier.NewManager(&resolverStub{values: make(map[string][]string)}, signerStub{}),
		2,
		time.Minute,
	)
	body := `{"domain":"refunds.example","admin":"0x99066fBc97557490fA794F750630bb41733D1004"}`
	for attempt := 1; attempt <= 3; attempt++ {
		response := httptest.NewRecorder()
		handler.ServeHTTP(
			response,
			httptest.NewRequest(http.MethodPost, "/v1/challenges", bytes.NewBufferString(body)),
		)
		if attempt < 3 && response.Code != http.StatusCreated {
			t.Fatalf("attempt %d unexpectedly returned %d", attempt, response.Code)
		}
		if attempt == 3 && response.Code != http.StatusTooManyRequests {
			t.Fatalf("rate-limited attempt returned %d", response.Code)
		}
	}
}

func newTestHandler() http.Handler {
	return NewHandler(verifier.NewManager(
		&resolverStub{values: make(map[string][]string)},
		signerStub{},
	))
}
