package attestor

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/anandh8x/dueback/services/verifier/internal/verifier"
)

var (
	addressPattern   = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	bytes32Pattern   = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
	signaturePattern = regexp.MustCompile(`^0x[0-9a-fA-F]{130}$`)
)

type Config struct {
	RPCURL          string
	RegistryAddress string
	Account         string
	KeystorePath    string
	PasswordFile    string
}

type Runner interface {
	Run(context.Context, string, ...string) (string, error)
}

type CastSigner struct {
	config Config
	runner Runner
}

func NewCastSigner(config Config) (*CastSigner, error) {
	if strings.TrimSpace(config.RPCURL) == "" {
		return nil, errors.New("Arc RPC URL is required")
	}
	if !addressPattern.MatchString(config.RegistryAddress) {
		return nil, errors.New("organization registry address is invalid")
	}
	if config.Account == "" && config.KeystorePath == "" {
		return nil, errors.New("Foundry account or keystore path is required")
	}
	if config.PasswordFile == "" {
		return nil, errors.New("keystore password file is required")
	}
	return &CastSigner{config: config, runner: commandRunner{}}, nil
}

func (s *CastSigner) Sign(ctx context.Context, request verifier.AttestationRequest) (verifier.Attestation, error) {
	organizationID, err := s.run(ctx,
		"call",
		s.config.RegistryAddress,
		"organizationIdFor(string)(bytes32)",
		request.Domain,
		"--rpc-url",
		s.config.RPCURL,
	)
	if err != nil {
		return verifier.Attestation{}, fmt.Errorf("derive organization id: %w", err)
	}
	if !bytes32Pattern.MatchString(organizationID) {
		return verifier.Attestation{}, errors.New("cast returned an invalid organization id")
	}

	validUntil := strconv.FormatInt(request.ValidUntil.Unix(), 10)
	tuple := fmt.Sprintf("(%s,%s,%s,%s)", organizationID, request.Admin, validUntil, request.Nonce)
	digest, err := s.run(ctx,
		"call",
		s.config.RegistryAddress,
		"hashDomainAttestation((bytes32,address,uint64,bytes32))(bytes32)",
		tuple,
		"--rpc-url",
		s.config.RPCURL,
	)
	if err != nil {
		return verifier.Attestation{}, fmt.Errorf("derive attestation digest: %w", err)
	}
	if !bytes32Pattern.MatchString(digest) {
		return verifier.Attestation{}, errors.New("cast returned an invalid attestation digest")
	}

	walletArgs := []string{"wallet", "sign", digest, "--no-hash"}
	if s.config.KeystorePath != "" {
		walletArgs = append(walletArgs, "--keystore", s.config.KeystorePath)
	} else {
		walletArgs = append(walletArgs, "--account", s.config.Account)
	}
	walletArgs = append(walletArgs, "--password-file", s.config.PasswordFile)
	signature, err := s.run(ctx, walletArgs...)
	if err != nil {
		return verifier.Attestation{}, fmt.Errorf("sign attestation digest: %w", err)
	}
	if !signaturePattern.MatchString(signature) {
		return verifier.Attestation{}, errors.New("cast returned an invalid attestation signature")
	}

	return verifier.Attestation{
		OrganizationID: organizationID,
		Admin:          request.Admin,
		ValidUntil:     request.ValidUntil,
		Nonce:          request.Nonce,
		Signature:      signature,
	}, nil
}

func (s *CastSigner) run(ctx context.Context, args ...string) (string, error) {
	return s.runner.Run(ctx, "cast", args...)
}

type commandRunner struct{}

func (commandRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, name, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s failed: %s", name, strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}
