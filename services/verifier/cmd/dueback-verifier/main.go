package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/anandh8x/dueback/services/verifier/internal/api"
	"github.com/anandh8x/dueback/services/verifier/internal/attestor"
	"github.com/anandh8x/dueback/services/verifier/internal/verifier"
)

func main() {
	config := attestor.Config{
		RPCURL:          required("DUEBACK_ARC_RPC_URL"),
		RegistryAddress: required("DUEBACK_ORGANIZATION_REGISTRY_ADDRESS"),
		Account: firstNonEmpty(
			os.Getenv("DUEBACK_VERIFIER_FOUNDRY_ACCOUNT"),
			os.Getenv("DUEBACK_FOUNDRY_ACCOUNT"),
		),
		KeystorePath: firstNonEmpty(
			os.Getenv("DUEBACK_VERIFIER_KEYSTORE_PATH"),
			os.Getenv("DUEBACK_KEYSTORE_PATH"),
		),
		PasswordFile: required("DUEBACK_PASSWORD_FILE"),
	}
	signer, err := attestor.NewCastSigner(config)
	if err != nil {
		log.Fatal(err)
	}
	manager, err := verifier.NewManagerWithOptions(net.DefaultResolver, signer, verifier.Options{
		StorePath:     envOr("DUEBACK_CHALLENGE_STORE_PATH", ".dueback-data/challenges.json"),
		MaxChallenges: envInt("DUEBACK_MAX_CHALLENGES", 10_000),
		VerifyTimeout: time.Duration(envInt("DUEBACK_VERIFY_TIMEOUT_SECONDS", 20)) * time.Second,
	})
	if err != nil {
		log.Fatal(err)
	}
	handler := api.AllowOrigin(
		api.NewHandler(manager),
		envOr("DUEBACK_VERIFIER_ALLOWED_ORIGIN", "http://localhost:5173"),
	)
	server := &http.Server{
		Addr:              envOr("DUEBACK_VERIFIER_LISTEN_ADDR", "127.0.0.1:8787"),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("verifier shutdown: %v", err)
		}
	}()

	log.Printf("DueBack verifier listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func required(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		log.Fatalf("%s must be a positive integer", name)
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
