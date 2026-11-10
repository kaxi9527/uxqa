package provider

import "testing"

func TestUXQAGoogleLoginRequiresExplicitClient(t *testing.T) {
	beforeGemini, beforeAntigravity := geminiApp, antigravityApp
	t.Cleanup(func() { geminiApp, antigravityApp = beforeGemini, beforeAntigravity })
	geminiApp.clientID, geminiApp.clientSecret = "", ""
	antigravityApp.clientID, antigravityApp.clientSecret = "", ""
	for _, agent := range []string{"gemini", "antigravity"} {
		if UXQASubscriptionRequirement(agent) == "" {
			t.Fatalf("%s must report missing client configuration", agent)
		}
	}
	geminiApp.clientID, geminiApp.clientSecret = "fixture-client", "fixture-not-a-secret"
	if UXQASubscriptionRequirement("gemini") != "" {
		t.Fatal("explicit client configuration should clear the configuration gate")
	}
	if UXQASubscriptionRequirement("codex") != "" {
		t.Fatal("Google client configuration must not affect Codex")
	}
}
