#!/usr/bin/env bash
#
# Create the first admin user in the DocProof Cognito User Pool.
#
# Usage:
#   ./scripts/seed-admin.sh <user-pool-id> <email> <password>
#
# Example:
#   ./scripts/seed-admin.sh ap-south-1_AbCdEfGhI admin@example.com MySecurePass123!
#
# The User Pool ID is printed in `sst dev` or `sst deploy` output.
# You can also find it in the AWS Console under Cognito > User Pools.
#

set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <user-pool-id> <email> <password>"
  echo ""
  echo "  user-pool-id  Cognito User Pool ID (e.g. ap-south-1_AbCdEfGhI)"
  echo "  email         Admin user email"
  echo "  password      Permanent password (min 8 chars, upper + lower + number)"
  exit 1
fi

USER_POOL_ID="$1"
EMAIL="$2"
PASSWORD="$3"

echo "Creating admin user: $EMAIL"

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes \
    Name=email,Value="$EMAIL" \
    Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --no-cli-pager

echo "Setting permanent password..."

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent \
  --no-cli-pager

echo ""
echo "Admin user created successfully."
echo "  Email: $EMAIL"
echo "  Pool:  $USER_POOL_ID"
echo ""
echo "To get a token for API calls, use the Cognito hosted UI or:"
echo ""
echo "  aws cognito-idp admin-initiate-auth \\"
echo "    --user-pool-id $USER_POOL_ID \\"
echo "    --client-id <client-id> \\"
echo "    --auth-flow ADMIN_USER_PASSWORD_AUTH \\"
echo "    --auth-parameters USERNAME=$EMAIL,PASSWORD=<password>"
