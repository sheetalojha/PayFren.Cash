#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const EMLStorageService = require('./services/EMLStorageService');
const logger = require('./utils/logger');

class PayCryptCLI {
  constructor() {
    this.emlStorage = new EMLStorageService();
  }

  /**
   * List EML files
   */
  async listFiles(options = {}) {
    try {
      const files = await this.emlStorage.listEMLFiles(options);
      
      console.log('\n📧 PayCrypt EML Files:');
      console.log('='.repeat(80));
      
      if (files.length === 0) {
        console.log('No EML files found.');
        return;
      }

      files.forEach((file, index) => {
        console.log(`\n${index + 1}. Email ID: ${file.emailId}`);
        console.log(`   From: ${file.from}`);
        console.log(`   To: ${file.to.join(', ')}`);
        console.log(`   Subject: ${file.subject || 'No subject'}`);
        console.log(`   Date: ${new Date(file.savedAt).toLocaleString()}`);
        console.log(`   Size: ${Math.round(file.size / 1024)} KB`);
        console.log(`   File: ${file.filename}`);
        
        if (file.transactionData) {
          console.log(`   💰 Transaction: ${file.transactionData.amount} ${file.transactionData.currency} → ${file.transactionData.recipientEmail}`);
        }
      });

      console.log(`\nTotal: ${files.length} files`);
    } catch (error) {
      console.error('Error listing files:', error.message);
    }
  }

  /**
   * Download EML file
   */
  async downloadFile(emailId, outputPath) {
    try {
      const content = await this.emlStorage.downloadEML(emailId);
      const metadata = await this.emlStorage.getEMLMetadata(emailId);
      
      const filename = outputPath || `${emailId}.eml`;
      fs.writeFileSync(filename, content);
      
      console.log(`✅ EML file downloaded: ${filename}`);
      console.log(`   Size: ${Math.round(content.length / 1024)} KB`);
      console.log(`   From: ${metadata.from}`);
      console.log(`   Subject: ${metadata.subject || 'No subject'}`);
    } catch (error) {
      console.error('Error downloading file:', error.message);
    }
  }

  /**
   * Show file metadata
   */
  async showMetadata(emailId) {
    try {
      const metadata = await this.emlStorage.getEMLMetadata(emailId);
      
      console.log('\n📋 Email Metadata:');
      console.log('='.repeat(50));
      console.log(`Email ID: ${metadata.emailId}`);
      console.log(`From: ${metadata.from}`);
      console.log(`To: ${metadata.to.join(', ')}`);
      console.log(`CC: ${metadata.cc.join(', ') || 'None'}`);
      console.log(`Subject: ${metadata.subject || 'No subject'}`);
      console.log(`Date: ${new Date(metadata.date).toLocaleString()}`);
      console.log(`Saved: ${new Date(metadata.savedAt).toLocaleString()}`);
      console.log(`Size: ${Math.round(metadata.size / 1024)} KB`);
      console.log(`Message ID: ${metadata.messageId || 'N/A'}`);
      
      if (metadata.transactionData) {
        console.log('\n💰 Transaction Details:');
        console.log(`Amount: ${metadata.transactionData.amount} ${metadata.transactionData.currency}`);
        console.log(`Recipient: ${metadata.transactionData.recipientEmail}`);
        console.log(`Type: ${metadata.transactionData.transactionType}`);
        console.log(`Timestamp: ${new Date(metadata.transactionData.timestamp).toLocaleString()}`);
      }
    } catch (error) {
      console.error('Error showing metadata:', error.message);
    }
  }

  /**
   * Show storage statistics
   */
  async showStats() {
    try {
      const stats = await this.emlStorage.getStorageStats();
      
      console.log('\n📊 Storage Statistics:');
      console.log('='.repeat(50));
      console.log(`Total Files: ${stats.totalFiles}`);
      console.log(`Total Size: ${stats.totalSizeMB} MB`);
      console.log(`Max Storage: ${stats.maxStorageSizeMB} MB`);
      console.log(`Usage: ${stats.usagePercentage}%`);
      console.log(`Storage Path: ${stats.storagePath}`);
      
      if (stats.oldestFile) {
        console.log(`Oldest File: ${stats.oldestFile.filename} (${new Date(stats.oldestFile.birthtime).toLocaleString()})`);
      }
      
      if (stats.newestFile) {
        console.log(`Newest File: ${stats.newestFile.filename} (${new Date(stats.newestFile.birthtime).toLocaleString()})`);
      }
    } catch (error) {
      console.error('Error showing stats:', error.message);
    }
  }

  /**
   * Delete EML file
   */
  async deleteFile(emailId) {
    try {
      await this.emlStorage.deleteEML(emailId);
      console.log(`✅ EML file deleted: ${emailId}`);
    } catch (error) {
      console.error('Error deleting file:', error.message);
    }
  }

  /**
   * Show help
   */
  showHelp() {
    console.log('\n🚀 PayCrypt CLI - Email Management Tool');
    console.log('='.repeat(50));
    console.log('Usage: node cli.js <command> [options]');
    console.log('\nCommands:');
    console.log('  list                    List all EML files');
    console.log('  download <emailId>      Download EML file');
    console.log('  metadata <emailId>      Show email metadata');
    console.log('  stats                   Show storage statistics');
    console.log('  delete <emailId>        Delete EML file');
    console.log('  help                    Show this help');
    console.log('\nExamples:');
    console.log('  node cli.js list');
    console.log('  node cli.js download email_1234567890_abc123def');
    console.log('  node cli.js metadata email_1234567890_abc123def');
    console.log('  node cli.js stats');
    console.log('  node cli.js delete email_1234567890_abc123def');
  }
}

// CLI execution
if (require.main === module) {
  const cli = new PayCryptCLI();
  const args = process.argv.slice(2);
  const command = args[0];
  const emailId = args[1];

  switch (command) {
    case 'list':
      cli.listFiles();
      break;
    case 'download':
      if (!emailId) {
        console.error('Error: Email ID required for download command');
        process.exit(1);
      }
      cli.downloadFile(emailId, args[2]);
      break;
    case 'metadata':
      if (!emailId) {
        console.error('Error: Email ID required for metadata command');
        process.exit(1);
      }
      cli.showMetadata(emailId);
      break;
    case 'stats':
      cli.showStats();
      break;
    case 'delete':
      if (!emailId) {
        console.error('Error: Email ID required for delete command');
        process.exit(1);
      }
      cli.deleteFile(emailId);
      break;
    case 'help':
    case '--help':
    case '-h':
      cli.showHelp();
      break;
    default:
      console.error('Error: Unknown command. Use "help" to see available commands.');
      process.exit(1);
  }
}

module.exports = PayCryptCLI;
