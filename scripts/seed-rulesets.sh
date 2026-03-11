#!/usr/bin/env bash
#
# Seed example rulesets into DocProof via the Admin API.
#
# Usage:
#   ./scripts/seed-rulesets.sh <api-url> <user-pool-id> <client-id> <email> <password>
#
# Example:
#   ./scripts/seed-rulesets.sh https://abc123.execute-api.ap-south-1.amazonaws.com \
#     ap-south-1_AbCdEfGhI  4a1b2c3d4e5f  admin@example.com MySecurePass123
#
# Prerequisites:
#   - Admin user created via seed-admin.sh
#   - AWS CLI configured with correct region
#   - jq installed

set -euo pipefail

if [ $# -lt 5 ]; then
  echo "Usage: $0 <api-url> <user-pool-id> <client-id> <email> <password>"
  echo ""
  echo "  api-url        API Gateway URL (e.g. https://abc123.execute-api.ap-south-1.amazonaws.com)"
  echo "  user-pool-id   Cognito User Pool ID (e.g. ap-south-1_AbCdEfGhI)"
  echo "  client-id      Cognito App Client ID"
  echo "  email          Admin user email"
  echo "  password       Admin user password"
  echo ""
  echo "All values are printed in 'sst dev' or 'sst deploy' output."
  exit 1
fi

API_URL="${1%/}"  # strip trailing slash
USER_POOL_ID="$2"
CLIENT_ID="$3"
EMAIL="$4"
PASSWORD="$5"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLES_DIR="$SCRIPT_DIR/../examples"

# Check dependencies
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed. Install it with: brew install jq"
  exit 1
fi

# Authenticate to get JWT token
echo "Authenticating as $EMAIL..."

AUTH_RESULT=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" \
  --no-cli-pager \
  --output json 2>&1)

TOKEN=$(echo "$AUTH_RESULT" | jq -r '.AuthenticationResult.IdToken // empty')

if [ -z "$TOKEN" ]; then
  echo "Error: Authentication failed."
  echo "$AUTH_RESULT"
  exit 1
fi

echo "Authenticated successfully."
echo ""

# Seed each example ruleset
SEEDED=0
FAILED=0

for dir in "$EXAMPLES_DIR"/*/; do
  RULESET_FILE="$dir/ruleset.json"
  if [ ! -f "$RULESET_FILE" ]; then
    continue
  fi

  RULESET_ID=$(jq -r '.id' "$RULESET_FILE")
  RULESET_NAME=$(jq -r '.name' "$RULESET_FILE")

  echo "Seeding: $RULESET_NAME ($RULESET_ID)..."

  HTTP_CODE=$(curl -s -o /tmp/seed-response.json -w "%{http_code}" \
    -X POST "$API_URL/admin/rule-sets" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @"$RULESET_FILE")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  OK ($HTTP_CODE)"
    SEEDED=$((SEEDED + 1))
  elif [ "$HTTP_CODE" = "409" ]; then
    echo "  Already exists (409) — skipping"
    SEEDED=$((SEEDED + 1))
  else
    echo "  FAILED ($HTTP_CODE)"
    cat /tmp/seed-response.json 2>/dev/null || true
    echo ""
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "Done. Seeded: $SEEDED, Failed: $FAILED"
