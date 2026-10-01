/**
 * Test script to verify device code flow works with OpenAI.
 * This tests the actual API endpoints without database.
 * 
 * Run: npx tsx src/scripts/test-device-flow.ts
 */

const AUTH_BASE_URL = "https://auth.openai.com";
const CLIENT_ID = "codex-cli-client";

async function testDeviceCodeFlow() {
  console.log("=== Testing OpenAI Device Code Flow ===\n");

  try {
    // Step 1: Request device code
    console.log("Step 1: Requesting device code...");
    console.log(`Endpoint: ${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`);

    const response = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
      }),
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Error response: ${errorText}`);
      
      if (response.status === 404) {
        console.log("\n❌ Device code login is NOT enabled for this endpoint.");
        console.log("   This could mean:");
        console.log("   1. The endpoint has changed");
        console.log("   2. Device code needs to be enabled in ChatGPT settings");
      }
      return;
    }

    const data = (await response.json()) as {
      user_code: string;
      device_auth_id: string;
      interval?: number;
    };
    console.log("\n✅ Device code request successful!");
    console.log("\n--- USER ACTION REQUIRED ---");
    console.log(`1. Open this URL: ${AUTH_BASE_URL}/codex/device`);
    console.log(`2. Enter this code: ${data.user_code}`);
    console.log(`3. Device Auth ID: ${data.device_auth_id}`);
    console.log(`4. Polling interval: ${data.interval} seconds`);
    console.log("----------------------------\n");

    console.log("Waiting for you to authorize in browser...");
    console.log("Polling for authorization...\n");

    // Step 2: Poll for authorization
    let authorized = false;
    let attempts = 0;
    const maxAttempts = 180; // 15 minutes at 5 sec intervals

    while (!authorized && attempts < maxAttempts) {
      attempts++;
      
      const pollResponse = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device_auth_id: data.device_auth_id,
          user_code: data.user_code,
        }),
      });

      if (pollResponse.ok) {
        const tokenData = (await pollResponse.json()) as {
          authorization_code?: string;
          code_verifier?: string;
          code_challenge?: string;
        };
        console.log("\n✅ Authorization successful!");
        console.log("\nReceived tokens:");
        console.log(`- Authorization code: ${tokenData.authorization_code?.substring(0, 20)}...`);
        console.log(`- Code verifier: ${tokenData.code_verifier?.substring(0, 20)}...`);
        console.log(`- Code challenge: ${tokenData.code_challenge?.substring(0, 20)}...`);
        
        authorized = true;
        
        // Step 3: Exchange for tokens
        console.log("\nStep 3: Exchanging authorization code for tokens...");
        const tokenResponse = await fetch(`${AUTH_BASE_URL}/api/accounts/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: tokenData.authorization_code ?? "",
            code_verifier: tokenData.code_verifier ?? "",
            code_challenge: tokenData.code_challenge ?? "",
            code_challenge_method: "S256",
            client_id: CLIENT_ID,
            redirect_uri: `${AUTH_BASE_URL}/deviceauth/callback`,
          }).toString(),
        });

        if (tokenResponse.ok) {
          const tokens = (await tokenResponse.json()) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            token_type?: string;
          };
          console.log("\n✅ Token exchange successful!");
          console.log(`- Access token: ${tokens.access_token?.substring(0, 30)}...`);
          console.log(`- Refresh token: ${tokens.refresh_token?.substring(0, 30)}...`);
          console.log(`- Expires in: ${tokens.expires_in} seconds`);
          console.log(`- Token type: ${tokens.token_type}`);
          
          // Test the token with OpenAI API
          console.log("\nStep 4: Testing token with OpenAI API...");
          const apiResponse = await fetch("https://api.openai.com/v1/models", {
            headers: {
              "Authorization": `Bearer ${tokens.access_token}`,
            },
          });

          if (apiResponse.ok) {
            const models = (await apiResponse.json()) as { data?: unknown[] };
            console.log(`✅ API call successful! Found ${models.data?.length || 0} models`);
          } else {
            console.log(`⚠️ API call returned: ${apiResponse.status}`);
            const errorText = await apiResponse.text();
            console.log(`Error: ${errorText.substring(0, 200)}`);
          }
        } else {
          console.log(`❌ Token exchange failed: ${tokenResponse.status}`);
          const errorText = await tokenResponse.text();
          console.log(`Error: ${errorText}`);
        }
        
        break;
      }

      // Show progress
      if (attempts % 12 === 0) {
        console.log(`Still waiting... (${Math.floor(attempts * 5 / 60)} minutes elapsed)`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, (data.interval || 5) * 1000));
    }

    if (!authorized) {
      console.log("\n❌ Timeout: No authorization received within 15 minutes");
    }

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    
    if (error.cause) {
      console.error("Cause:", error.cause);
    }
  }
}

// Run the test
testDeviceCodeFlow();
