const { simpleParser } = require('mailparser');
const logger = require('../utils/logger');
const config = require('../config/config');

class EmailParser {
  constructor() {
    this.transactionPatterns = [
      // New pattern: "send 5 dot: dil mange more!" (amount currency: call_sign)
      /send\s+(\d+(?:\.\d+)?)\s+(\w+):\s*(.+)/i,
      
      // Legacy patterns for backward compatibility
      // Pattern 1: "Send 0.1 PYUSD to recipient@example.com"
      /send\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      
      // Pattern 2: "Transfer 0.5 BTC to user@domain.com"
      /transfer\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      
      // Pattern 3: "Pay 100 USDC to john@example.com"
      /pay\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    ];

    // Balance inquiry pattern
    this.balanceInquiryPattern = /payfren:\s*what'?s?\s*my\s*balance\?/i;

    this.supportedCurrencies = [
      'BTC', 'ETH', 'USDC', 'USDT', 'PYUSD', 'DAI', 'MATIC', 'SOL', 'ADA', 'DOT'
    ];

    // PayCrypt processing email addresses - support multiple domains
    this.paycryptEmails = config.email.paycryptEmails;
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
      
      // Extract balance inquiry details
      const balanceInquiry = this.extractBalanceInquiry(emailData);
      
      return {
        ...emailData,
        transactionData,
        balanceInquiry,
        isValidTransaction: !!transactionData,
        isValidBalanceInquiry: !!balanceInquiry
      };

    } catch (error) {
      logger.emailError('unknown', error, { context: 'email_parsing' });
      throw new Error(`Failed to parse email: ${error.message}`);
    }
  }

  /**
   * Check if email is a balance inquiry
   * @param {Object} emailData - Parsed email data
   * @returns {Object|null} Balance inquiry details or null
   */
  extractBalanceInquiry(emailData) {
    try {
      const emailBody = (emailData.text || emailData.html || '').toLowerCase();
      
      // Check if it's a balance inquiry
      const balanceMatch = emailBody.match(this.balanceInquiryPattern);
      if (!balanceMatch) {
        return null;
      }

      // Check if only PayCrypt emails are in 'to' field (no other recipients)
      const hasOnlyPaycryptEmails = emailData.to.every(addr => 
        this.paycryptEmails.includes(addr.toLowerCase())
      );

      if (!hasOnlyPaycryptEmails) {
        logger.info('Balance inquiry ignored - other recipients found', {
          emailId: emailData.id,
          to: emailData.to,
          paycryptEmails: this.paycryptEmails
        });
        return null;
      }

      logger.info('Balance inquiry detected', {
        emailId: emailData.id,
        from: emailData.from,
        to: emailData.to
      });

      return {
        senderEmail: emailData.from.toLowerCase(),
        inquiryType: 'balance_check',
        timestamp: emailData.date,
        emailId: emailData.id,
        messageId: emailData.messageId
      };

    } catch (error) {
      logger.error('Error extracting balance inquiry', { 
        emailId: emailData.id, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Extract transaction details from email content
   * @param {Object} emailData - Parsed email data
   * @returns {Object|null} Transaction details or null if not found
   */
  extractTransactionDetails(emailData) {
    const content = `${emailData.subject} ${emailData.text}`.toLowerCase();
    
    for (let i = 0; i < this.transactionPatterns.length; i++) {
      const pattern = this.transactionPatterns[i];
      const match = content.match(pattern);
      
      if (match) {
        const amount = parseFloat(match[1]);
        const currency = match[2].toUpperCase();
        
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

        // Check if any PayCrypt processing email is in CC or TO
        const isPaycryptTransaction = 
          emailData.to.some(addr => this.paycryptEmails.includes(addr.toLowerCase())) ||
          emailData.cc.some(addr => this.paycryptEmails.includes(addr.toLowerCase()));

        if (!isPaycryptTransaction) {
          logger.warn('PayCrypt email not found in recipients', { 
            emailId: emailData.id, 
            to: emailData.to, 
            cc: emailData.cc,
            expectedEmails: this.paycryptEmails
          });
          continue;
        }

        // Handle new format: "send 5 dot: dil mange more!"
        if (i === 0 && match[3]) {
          const callSign = match[3].trim();
          
          // Get recipient email from 'to' field (first non-PayCrypt email)
          const recipientEmail = emailData.to.find(addr => 
            !this.paycryptEmails.includes(addr.toLowerCase())
          )?.toLowerCase();
          
          return {
            amount,
            currency,
            callSign,
            recipientEmail,
            senderEmail: emailData.from.toLowerCase(),
            transactionType: 'transfer_with_call_sign',
            timestamp: emailData.date,
            emailId: emailData.id,
            messageId: emailData.messageId
          };
        }
        
        // Handle legacy format: "send 5 dot to recipient@example.com"
        if (i > 0 && match[3]) {
          const recipientEmail = match[3].toLowerCase();
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
