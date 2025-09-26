#!/usr/bin/env node

/**
 * PayCrypt Email Server Test Script
 * 
 * This script demonstrates how to test the email server functionality
 * by creating a mock email and processing it through the system.
 */

const fs = require('fs');
const EmailParser = require('./services/EmailParser');
const EMLStorageService = require('./services/EMLStorageService');
const logger = require('./utils/logger');

async function testEmailProcessing() {
  console.log('🧪 Testing PayCrypt Email Processing...\n');

  try {
    // Create test email content
    const testEmail = `From: sender@example.com
To: recipient@example.com
CC: send@paycrypt.xyz
Subject: Send 0.1 PYUSD to recipient@example.com
Date: ${new Date().toUTCString()}
Message-ID: <test-${Date.now()}@example.com>

Send 0.1 PYUSD to recipient@example.com

This is a test transaction for the PayCrypt protocol.
`;

    console.log('📧 Test Email Content:');
    console.log('='.repeat(50));
    console.log(testEmail);
    console.log('='.repeat(50));

    // Initialize services
    const emailParser = new EmailParser();
    const emlStorage = new EMLStorageService();

    // Parse the email
    console.log('\n🔍 Parsing email...');
    const emailBuffer = Buffer.from(testEmail);
    const parsedEmail = await emailParser.parseEmail(emailBuffer);

    console.log('✅ Email parsed successfully!');
    console.log(`   Email ID: ${parsedEmail.id}`);
    console.log(`   From: ${parsedEmail.from}`);
    console.log(`   To: ${parsedEmail.to.join(', ')}`);
    console.log(`   Subject: ${parsedEmail.subject}`);
    console.log(`   Valid Transaction: ${parsedEmail.isValidTransaction}`);

    if (parsedEmail.isValidTransaction) {
      console.log('\n💰 Transaction Details:');
      console.log(`   Amount: ${parsedEmail.transactionData.amount}`);
      console.log(`   Currency: ${parsedEmail.transactionData.currency}`);
      console.log(`   Recipient: ${parsedEmail.transactionData.recipientEmail}`);
      console.log(`   Sender: ${parsedEmail.transactionData.senderEmail}`);
    }

    // Save EML file
    console.log('\n💾 Saving EML file...');
    const emlPath = await emlStorage.saveEML(parsedEmail.id, emailBuffer, {
      from: parsedEmail.from,
      to: parsedEmail.to,
      cc: parsedEmail.cc,
      subject: parsedEmail.subject,
      date: parsedEmail.date,
      messageId: parsedEmail.messageId,
      testMode: true
    });

    console.log(`✅ EML file saved: ${emlPath}`);

    // Test CLI functionality
    console.log('\n📋 Testing storage operations...');
    
    // List files
    const files = await emlStorage.listEMLFiles();
    console.log(`📁 Found ${files.length} EML files`);

    // Get storage stats
    const stats = await emlStorage.getStorageStats();
    console.log('\n📊 Storage Statistics:');
    console.log(`   Total Files: ${stats.totalFiles}`);
    console.log(`   Total Size: ${stats.totalSizeMB} MB`);
    console.log(`   Usage: ${stats.usagePercentage}%`);

    // Test download
    console.log('\n⬇️  Testing download...');
    const downloadedContent = await emlStorage.downloadEML(parsedEmail.id);
    console.log(`✅ Downloaded ${downloadedContent.length} bytes`);

    // Test metadata
    console.log('\n📋 Testing metadata retrieval...');
    const metadata = await emlStorage.getEMLMetadata(parsedEmail.id);
    console.log(`✅ Retrieved metadata for ${metadata.emailId}`);

    console.log('\n🎉 All tests completed successfully!');
    console.log('\nTo view the saved email, run:');
    console.log(`   node src/cli.js list`);
    console.log(`   node src/cli.js metadata ${parsedEmail.id}`);
    console.log(`   node src/cli.js download ${parsedEmail.id}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testEmailProcessing();
}

module.exports = testEmailProcessing;
