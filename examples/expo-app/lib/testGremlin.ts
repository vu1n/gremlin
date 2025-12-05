/**
 * Test script for Gremlin recorder
 * Run this to verify the recorder is working correctly
 */

import { GremlinRecorder } from './gremlin';

export function testGremlinRecorder() {
  console.log('=== Testing Gremlin Recorder ===\n');

  // Create a new recorder instance
  const recorder = new GremlinRecorder({ debug: true });

  // Start recording
  console.log('1. Starting recorder...');
  recorder.start();

  // Simulate navigation
  console.log('\n2. Simulating navigation...');
  recorder.recordNavigation('home', 'products');

  // Simulate taps
  console.log('\n3. Simulating tap events...');
  recorder.recordTap('products-product-card-1', {
    productId: '1',
    productName: 'Wireless Headphones',
  });
  recorder.recordTap('product-1-add-to-cart-button');

  // Simulate scroll
  console.log('\n4. Simulating scroll...');
  recorder.recordScroll({ offsetY: 100 });

  // Simulate input
  console.log('\n5. Simulating text input...');
  recorder.recordInput('checkout-name-input', 'John Doe');
  recorder.recordInput('checkout-email-input', 'john@example.com');

  // Stop recording
  console.log('\n6. Stopping recorder...');
  recorder.stop();

  // Export session
  console.log('\n7. Exporting session...');
  const session = recorder.exportSession();
  console.log('\nSession Summary:');
  console.log(`- Session ID: ${session.sessionId}`);
  console.log(`- Total Events: ${session.events.length}`);
  console.log(`- Duration: ${session.duration}ms`);
  console.log('\nEvents:');
  session.events.forEach((event, index) => {
    console.log(
      `  ${index + 1}. ${event.type} on ${event.screen}${
        event.testID ? ` (${event.testID})` : ''
      }`
    );
  });

  console.log('\n=== Test Complete ===');

  return session;
}
