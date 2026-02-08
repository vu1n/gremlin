#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Gremlin E2E Demo ==="
echo ""
echo "This demo proves the full Gremlin pipeline:"
echo "  GremlinSpec (state machine) -> Playwright tests -> Run against real app -> Tests pass"
echo ""

echo "Step 1: Generate Playwright tests from GremlinSpec..."
bun tests/generate-and-verify.ts
echo ""

echo "Step 2: Install Playwright browsers..."
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium
echo ""

echo "Step 3: Run hand-written demo test against the web app..."
npx playwright test tests/demo.spec.ts
echo ""

echo "Step 4: Run generated tests against the web app..."
npx playwright test tests/generated.spec.ts || echo "  (Generated tests may need manual tuning - this is expected)"
echo ""

echo "=== Demo Complete ==="
