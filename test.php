<?php
header('Content-Type: text/html');
include 'api.php';

$testId = $_GET['id'] ?? null;
if (!$testId) {
    die('No test ID provided');
}

$tests = getTests();
$test = null;
foreach ($tests as $t) {
    if ($t['id'] === $testId) {
        $test = $t;
        break;
    }
}

if (!$test) {
    die('Test not found');
}

// Redirect to the HTML page with the test data
header('Location: test.html?id=' . $testId); 