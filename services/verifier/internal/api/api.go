package api

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/anandh8x/dueback/services/verifier/internal/verifier"
)

const maxRequestBytes = 16 * 1024

type Handler struct {
	manager *verifier.Manager
	limiter *rateLimiter
}

func NewHandler(manager *verifier.Manager) http.Handler {
	return NewHandlerWithRateLimit(manager, 10, time.Minute)
}

func NewHandlerWithRateLimit(
	manager *verifier.Manager,
	maxRequests int,
	window time.Duration,
) http.Handler {
	handler := &Handler{
		manager: manager,
		limiter: newRateLimiter(maxRequests, window),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handler.health)
	mux.HandleFunc("POST /v1/challenges", handler.createChallenge)
	mux.HandleFunc("POST /v1/challenges/{id}/verify", handler.verifyChallenge)
	return securityHeaders(mux)
}

func AllowOrigin(next http.Handler, allowedOrigin string) http.Handler {
	origin := strings.TrimSpace(allowedOrigin)
	if origin == "" {
		return next
	}
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Origin") == origin {
			response.Header().Set("Access-Control-Allow-Origin", origin)
			response.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			response.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			response.Header().Set("Vary", "Origin")
		}
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func (h *Handler) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) createChallenge(response http.ResponseWriter, request *http.Request) {
	if !h.limiter.allow(clientIP(request), time.Now()) {
		response.Header().Set("Retry-After", "60")
		writeError(response, http.StatusTooManyRequests, "too many verification requests")
		return
	}
	var input struct {
		Domain string `json:"domain"`
		Admin  string `json:"admin"`
	}
	if err := decodeJSON(response, request, &input); err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	challenge, err := h.manager.Create(input.Domain, input.Admin)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, challenge)
}

type rateEntry struct {
	start time.Time
	count int
}

type rateLimiter struct {
	mu          sync.Mutex
	entries     map[string]rateEntry
	maxRequests int
	window      time.Duration
}

func newRateLimiter(maxRequests int, window time.Duration) *rateLimiter {
	if maxRequests <= 0 {
		maxRequests = 10
	}
	if window <= 0 {
		window = time.Minute
	}
	return &rateLimiter{entries: make(map[string]rateEntry), maxRequests: maxRequests, window: window}
}

func (limiter *rateLimiter) allow(key string, now time.Time) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	for existingKey, existing := range limiter.entries {
		if now.Sub(existing.start) >= limiter.window {
			delete(limiter.entries, existingKey)
		}
	}
	entry := limiter.entries[key]
	if entry.start.IsZero() || now.Sub(entry.start) >= limiter.window {
		if len(limiter.entries) >= 10_000 {
			return false
		}
		limiter.entries[key] = rateEntry{start: now, count: 1}
		return true
	}
	if entry.count >= limiter.maxRequests {
		return false
	}
	entry.count++
	limiter.entries[key] = entry
	return true
}

func clientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return request.RemoteAddr
}

func (h *Handler) verifyChallenge(response http.ResponseWriter, request *http.Request) {
	id := strings.TrimSpace(request.PathValue("id"))
	if id == "" || len(id) > 64 {
		writeError(response, http.StatusBadRequest, "invalid challenge id")
		return
	}
	attestation, err := h.manager.Verify(request.Context(), id)
	if err != nil {
		switch {
		case errors.Is(err, verifier.ErrChallengeMissing):
			writeError(response, http.StatusNotFound, err.Error())
		case errors.Is(err, verifier.ErrChallengeExpired), errors.Is(err, verifier.ErrChallengeUsed):
			writeError(response, http.StatusConflict, err.Error())
		case errors.Is(err, verifier.ErrDNSProofMissing):
			writeError(response, http.StatusUnprocessableEntity, err.Error())
		default:
			writeError(response, http.StatusBadGateway, "could not verify and sign this domain")
		}
		return
	}
	writeJSON(response, http.StatusOK, attestation)
}

func decodeJSON(response http.ResponseWriter, request *http.Request, target any) error {
	request.Body = http.MaxBytesReader(response, request.Body, maxRequestBytes)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("request body must be valid JSON with only domain and admin")
	}
	if decoder.Decode(&struct{}{}) == nil {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, message string) {
	writeJSON(response, status, map[string]string{"error": message})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(response, request)
	})
}
