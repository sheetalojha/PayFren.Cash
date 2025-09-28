const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');

class EmailParser {
  constructor() {
    this.transactionPatterns = [
      // Pattern 1: "Send 0.1 PYUSD to recipient@example.com"
      /send\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      
      // Pattern 2: "Transfer 0.5 BTC to user@domain.com"
      /transfer\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      
      // Pattern 3: "Pay 100 USDC to john@example.com"
      /pay\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      
      // Pattern 4: "Send 0.01 ETH to alice@crypto.com"
      /send\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    ];

    this.supportedCurrencies = [
      'BTC', 'ETH', 'USDC', 'USDT', 'PYUSD', 'DAI', 'MATIC', 'SOL', 'ADA', 'DOT'
    ];
  }

  /**
   * Parse email content and extract transaction details
   * @param {Buffer} emailBuffer - Raw email buffer
   * @returns {Promise<Object>} Parsed email data with transaction details
   */
  async parseEmail(emailBuffer) {
    try {
      const parsed = await simpleParser(emailBuffer);
      
      const emailData = {
        id: this.generateEmailId(),
        from: this.extractEmailAddress(parsed.from),
        to: this.extractEmailAddresses(parsed.to),
        cc: this.extractEmailAddresses(parsed.cc),
        bcc: this.extractEmailAddresses(parsed.bcc),
        subject: parsed.subject || '',
        text: parsed.text || '',
        html: parsed.html || '',
        date: parsed.date || new Date(),
        attachments: parsed.attachments || [],
        headers: parsed.headers || {},
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        raw: emailBuffer
      };

      // Extract transaction details
      const transactionData = this.extractTransactionDetails(emailData);
      
      return {
        ...emailData,
        transactionData,
        isValidTransaction: !!transactionData
      };

    } catch (error) {
      logger.emailError('unknown', error, { context: 'email_parsing' });
      throw new Error(`Failed to parse email: ${error.message}`);
    }
  }

  /**
   * Extract transaction details from email content
   * @param {Object} emailData - Parsed email data
   * @returns {Object|null} Transaction details or null if not found
   */
  extractTransactionDetails(emailData) {
    const content = `${emailData.subject} ${emailData.text}`.toLowerCase();
    
    for (const pattern of this.transactionPatterns) {
      const match = content.match(pattern);
      if (match) {
        const amount = parseFloat(match[1]);
        const currency = match[2].toUpperCase();
        const recipientEmail = match[3].toLowerCase();

        // Validate currency
        if (!this.supportedCurrencies.includes(currency)) {
          logger.warn('Unsupported currency detected', { currency, emailId: emailData.id });
          continue;
        }

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
          logger.warn('Invalid amount detected', { amount, emailId: emailData.id });
          continue;
        }

        return {
          amount,
          currency,
          recipientEmail,
          senderEmail: emailData.from.toLowerCase(),
          transactionType: 'transfer',
          timestamp: emailData.date,
          emailId: emailData.id,
          messageId: emailData.messageId
        };
      }
    }

    return null;
  }

  /**
   * Extract single email address from mailparser format
   * @param {Object|String} address - Email address from mailparser
   * @returns {String} Email address
   */
  extractEmailAddress(address) {
    if (!address) return '';
    
    if (typeof address === 'string') {
      return address.toLowerCase();
    }
    
    if (address.value && address.value.length > 0) {
      return address.value[0].address.toLowerCase();
    }
    
    return '';
  }

  /**
   * Extract multiple email addresses from mailparser format
   * @param {Object|String|Array} addresses - Email addresses from mailparser
   * @returns {Array} Array of email addresses
   */
  extractEmailAddresses(addresses) {
    if (!addresses) return [];
    
    if (typeof addresses === 'string') {
      return [addresses.toLowerCase()];
    }
    
    if (Array.isArray(addresses)) {
      return addresses.map(addr => this.extractEmailAddress(addr));
    }
    
    if (addresses.value && Array.isArray(addresses.value)) {
      return addresses.value.map(addr => addr.address.toLowerCase());
    }
    
    return [];
  }

  /**
   * Generate unique email ID
   * @returns {String} Unique email identifier
   */
  generateEmailId() {
    return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate email format
   * @param {String} email - Email address to validate
   * @returns {Boolean} True if valid email format
   */
  isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
  }

  /**
   * Get supported currencies
   * @returns {Array} List of supported currencies
   */
  getSupportedCurrencies() {
    return [...this.supportedCurrencies];
  }

  /**
   * Add new transaction pattern
   * @param {RegExp} pattern - Regular expression pattern
   */
  addTransactionPattern(pattern) {
    this.transactionPatterns.push(pattern);
  }

  /**
   * Add new supported currency
   * @param {String} currency - Currency code
   */
  addSupportedCurrency(currency) {
    if (!this.supportedCurrencies.includes(currency.toUpperCase())) {
      this.supportedCurrencies.push(currency.toUpperCase());
    }
  }
}

module.exports = EmailParser;
