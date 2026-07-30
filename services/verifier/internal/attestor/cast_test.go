package attestor

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/anandh8x/dueback/services/verifier/internal/verifier"
)

type runnerStub struct {
	outputs []string
	calls   [][]string
}

func (r *runnerStub) Run(_ context.Context, name string, args ...string) (string, error) {
	r.calls = append(r.calls, append([]string{name}, args...))
	if len(r.outputs) == 0 {
		return "", errors.New("unexpected command")
	}
	output := r.outputs[0]
	r.outputs = r.outputs[1:]
	return output, nil
}

func TestCastSignerBuildsContractDigestAndSignsIt(t *testing.T) {
	signer, err := NewCastSigner(Config{
		RPCURL:          "https://rpc.testnet.arc.network",
		RegistryAddress: "0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5",
		Account:         "quietpact-arc-testnet",
		PasswordFile:    "/tmp/password",
	})
	if err != nil {
		t.Fatal(err)
	}
	runner := &runnerStub{outputs: []string{
		"0x" + strings.Repeat("11", 32),
		"0x" + strings.Repeat("22", 32),
		"0x" + strings.Repeat("33", 65),
	}}
	signer.runner = runner
	request := verifier.AttestationRequest{
		Domain:     "refunds.example",
		Admin:      "0x99066fBc97557490fA794F750630bb41733D1004",
		ValidUntil: time.Unix(1_800_000_000, 0),
		Nonce:      "0x" + strings.Repeat("44", 32),
	}

	attestation, err := signer.Sign(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if attestation.Signature != "0x"+strings.Repeat("33", 65) {
		t.Fatal("unexpected signature")
	}
	if len(runner.calls) != 3 {
		t.Fatalf("expected three cast calls, received %d", len(runner.calls))
	}
	signCall := strings.Join(runner.calls[2], " ")
	if !strings.Contains(signCall, "--no-hash") ||
		!strings.Contains(signCall, "--password-file /tmp/password") {
		t.Fatalf("unsafe or incomplete signing command: %s", signCall)
	}
}

func TestCastSignerRejectsIncompleteConfiguration(t *testing.T) {
	for _, config := range []Config{
		{},
		{RPCURL: "rpc", RegistryAddress: "0x1234", Account: "account", PasswordFile: "file"},
		{
			RPCURL:          "rpc",
			RegistryAddress: "0x5028C830C3260fE5604B7F39eB118a1F3dBe34f5",
			PasswordFile:    "file",
		},
	} {
		if _, err := NewCastSigner(config); err == nil {
			t.Fatalf("accepted invalid config %+v", config)
		}
	}
}
