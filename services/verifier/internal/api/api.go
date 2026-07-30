package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/anandh8x/dueback/services/verifier/internal/verifier"
)

const maxRequestBytes = 16 * 1024

type Handler struct {
	manager *verifier.Manager
}

func NewHandler(manager *verifier.Manager) http.Handler {
	handler := &Handler{manager: manager}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handler.health)
	mux.HandleFunc("POST /v1/challenges", handler.createChallenge)
	mux.HandleFunc("POST /v1/challenges/{id}/verify", handler.verifyChallenge)
	return securityHeaders(mux)
}

func (h *Handler) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) createChallenge(response http.ResponseWriter, request *http.Request) {
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
