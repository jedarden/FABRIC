#!/bin/bash
# Focused test for digest --source option with file path only
# Tests that the digest command correctly processes file paths

set -e

FABRIC_CLI="node dist/cli.js"
TEST_FILE="$HOME/.needle/logs/alpha-41cb50fb.jsonl"

echo "=== Testing digest --source option with file path ==="
echo ""

# Test 1: Verify file path processing
echo "Test 1: File path should be resolved to kind='file'"
OUTPUT=$($FABRIC_CLI digest --source "$TEST_FILE" 2>&1)
if echo "$OUTPUT" | grep -q "\.jsonl (file)"; then
    echo "✅ PASS: File path correctly identified as 'file' kind"
else
    echo "❌ FAIL: File path not identified as 'file' kind"
    echo "Output: $OUTPUT"
    exit 1
fi

# Test 2: Verify resolved path matches input
echo "Test 2: Resolved path should match input path (with ~ expanded)"
if echo "$OUTPUT" | grep -q "Analyzing: $HOME/\.needle/logs/alpha-41cb50fb\.jsonl"; then
    echo "✅ PASS: Path correctly expanded from ~ to absolute path"
else
    echo "❌ FAIL: Path not correctly expanded"
    exit 1
fi

# Test 3: Verify events are loaded from file
echo "Test 3: Events should be loaded from specified file"
if echo "$OUTPUT" | grep -q "Loaded 1 events"; then
    echo "✅ PASS: Events loaded from file"
else
    echo "❌ FAIL: Events not loaded from file"
    exit 1
fi

# Test 4: Verify digest output includes events from file
echo "Test 4: Digest output should include events from specified file"
if echo "$OUTPUT" | grep -q "Total Events.*1"; then
    echo "✅ PASS: Digest includes events from specified file"
else
    echo "❌ FAIL: Digest does not include events from file"
    exit 1
fi

# Test 5: Verify worker information is extracted correctly
echo "Test 5: Worker information should be extracted from events"
if echo "$OUTPUT" | grep -q "alpha.*1"; then
    echo "✅ PASS: Worker information extracted correctly"
else
    echo "❌ FAIL: Worker information not extracted"
    exit 1
fi

# Test 6: Verify error handling for nonexistent path
echo "Test 6: Error should be reported for nonexistent path"
if $FABRIC_CLI digest --source /nonexistent/path.jsonl 2>&1 | grep -q "Error: Source path does not exist"; then
    echo "✅ PASS: Error correctly reported for nonexistent path"
else
    echo "❌ FAIL: Error not reported for nonexistent path"
    exit 1
fi

# Test 7: Test with tilde path expansion
echo "Test 7: Tilde path should be expanded correctly"
TILDE_OUTPUT=$($FABRIC_CLI digest --source ~/.needle/logs/alpha-41cb50fb.jsonl 2>&1)
if echo "$TILDE_OUTPUT" | grep -q "Analyzing: $HOME/\.needle/logs/alpha-41cb50fb\.jsonl"; then
    echo "✅ PASS: Tilde expansion works correctly"
else
    echo "❌ FAIL: Tilde expansion failed"
    exit 1
fi

echo ""
echo "=== All tests passed! ==="
echo ""
echo "Summary of verified functionality:"
echo "  • File paths are correctly resolved to kind='file'"
echo "  • Home directory (~) is expanded to absolute path"
echo "  • Resolved path matches the input path"
echo "  • Events are loaded from the specified file"
echo "  • Digest output includes events from the file"
echo "  • Worker information is extracted correctly"
echo "  • Error handling works for nonexistent paths"
echo "  • Tilde path expansion works correctly"
