const logger = require('../utils/logger');
const EmailReplyService = require('./EmailReplyService');

class NotificationService {
  constructor() {
    this.emailReplyService = new EmailReplyService();
    this.isInitialized = false;
    this.initializePromise = this.initialize();
  }

  /**
   * Initialize the notification service
   */
  async initialize() {
    try {
      await this.emailReplyService.waitForInitialization();
      this.isInitialized = this.emailReplyService.getStatus().isInitialized;
      
      if (this.isInitialized) {
        logger.info('NotificationService initialized successfully');
      } else {
        logger.warn('NotificationService initialized but email service not available');
      }
    } catch (error) {
      logger.error('Failed to initialize NotificationService', { 
        error: error.message 
      });
      this.isInitialized = false;
    }
  }

  /**
   * Wait for service initialization to complete
   * @returns {Promise<void>}
   */
  async waitForInitialization() {
    if (this.initializePromise) {
      await this.initializePromise;
    }
  }

  /**
   * Send balance inquiry response
   * @param {Object} originalEmail - Original email data
   * @param {Object} balanceResult - Balance inquiry result
   * @returns {Promise<Object>} Response results
   */
  async sendBalanceInquiryResponse(originalEmail, balanceResult) {
    try {
      if (!this.isInitialized) {
        logger.warn('NotificationService not initialized, skipping balance inquiry response');
        return {
          success: false,
          error: 'NotificationService not initialized',
          senderNotification: null
        };
      }

      const results = {
        success: true,
        senderNotification: null,
        errors: []
      };

      // Send response to sender only (balance inquiry is personal)
      try {
        const senderResult = await this.sendSenderBalanceResponse(originalEmail, balanceResult);
        results.senderNotification = senderResult;
        
        if (!senderResult.success) {
          results.errors.push(`Sender balance response failed: ${senderResult.error}`);
        }
      } catch (error) {
        logger.error('Error sending sender balance response', {
          emailId: originalEmail.id,
          error: error.message
        });
        results.errors.push(`Sender balance response error: ${error.message}`);
      }

      // Check if there were any errors
      if (results.errors.length > 0) {
        results.success = false;
      }

      return results;

    } catch (error) {
      logger.error('Error in sendBalanceInquiryResponse', {
        emailId: originalEmail.id,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message,
        senderNotification: null
      };
    }
  }

  /**
   * Send transaction notifications to both sender and recipient
   * @param {Object} originalEmail - Original email data
   * @param {Object} transactionResult - Transaction processing result
   * @returns {Promise<Object>} Notification results
   */
  async sendTransactionNotifications(originalEmail, transactionResult) {
    try {
      if (!this.isInitialized) {
        logger.warn('NotificationService not initialized, skipping notifications');
        return {
          success: false,
          error: 'NotificationService not initialized',
          senderNotification: null,
          recipientNotification: null
        };
      }

      const results = {
        success: true,
        senderNotification: null,
        recipientNotification: null,
        errors: []
      };

      // Send notification to sender (transaction confirmation)
      try {
        const senderResult = await this.sendSenderNotification(originalEmail, transactionResult);
        results.senderNotification = senderResult;
        
        if (!senderResult.success) {
          results.errors.push(`Sender notification failed: ${senderResult.error}`);
        }
      } catch (error) {
        logger.error('Error sending sender notification', {
          emailId: originalEmail.id,
          error: error.message
        });
        results.errors.push(`Sender notification error: ${error.message}`);
      }

      // Send notification to recipient (if different from sender)
      try {
        if (originalEmail.recipientEmail && 
            originalEmail.recipientEmail !== originalEmail.from) {
          const recipientResult = await this.sendRecipientNotification(originalEmail, transactionResult);
          results.recipientNotification = recipientResult;
          
          if (!recipientResult.success) {
            results.errors.push(`Recipient notification failed: ${recipientResult.error}`);
          }
        } else {
          logger.info('Skipping recipient notification - same as sender or no recipient email', {
            emailId: originalEmail.id,
            sender: originalEmail.from,
            recipient: originalEmail.recipientEmail
          });
        }
      } catch (error) {
        logger.error('Error sending recipient notification', {
          emailId: originalEmail.id,
          error: error.message
        });
        results.errors.push(`Recipient notification error: ${error.message}`);
      }

      // Determine overall success
      results.success = results.errors.length === 0;

      logger.info('Transaction notifications sent', {
        emailId: originalEmail.id,
        senderSuccess: results.senderNotification?.success || false,
        recipientSuccess: results.recipientNotification?.success || false,
        overallSuccess: results.success,
        errors: results.errors
      });

      return results;

    } catch (error) {
      logger.error('Error in sendTransactionNotifications', {
        emailId: originalEmail.id,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message,
        senderNotification: null,
        recipientNotification: null
      };
    }
  }

  /**
   * Send balance response to sender
   * @param {Object} originalEmail - Original email data
   * @param {Object} balanceResult - Balance inquiry result
   * @returns {Promise<Object>} Notification result
   */
  async sendSenderBalanceResponse(originalEmail, balanceResult) {
    try {
      const emailBody = this.emailReplyService.generateBalanceInquiryEmailBody(balanceResult);
      const plainTextBody = this.emailReplyService.generatePlainTextFromHtml(emailBody);
      
      const result = await this.emailReplyService.sendCustomEmail({
        to: originalEmail.from,
        subject: `Re: ${originalEmail.subject || 'Balance Inquiry'}`,
        htmlBody: emailBody,
        textBody: plainTextBody
      });
      
      logger.info('Balance inquiry response sent to sender', {
        emailId: originalEmail.id,
        sender: originalEmail.from,
        balanceAction: balanceResult.action,
        walletAddress: balanceResult.walletAddress
      });

      return {
        success: true,
        recipient: originalEmail.from,
        messageId: result.messageId
      };

    } catch (error) {
      logger.error('Error sending balance inquiry response to sender', {
        emailId: originalEmail.id,
        sender: originalEmail.from,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        recipient: originalEmail.from
      };
    }
  }

  /**
   * Send notification to sender (transaction confirmation)
   * @param {Object} originalEmail - Original email data
   * @param {Object} transactionResult - Transaction processing result
   * @returns {Promise<Object>} Send result
   */
  async sendSenderNotification(originalEmail, transactionResult) {
    try {
      const result = await this.emailReplyService.sendTransactionConfirmation({
        to: originalEmail.from,
        originalMessageId: originalEmail.messageId,
        originalSubject: originalEmail.subject,
        transactionResult: transactionResult,
        originalEmail: originalEmail
      });

      if (result.success) {
        logger.info('Sender notification sent successfully', {
          emailId: originalEmail.id,
          to: originalEmail.from,
          messageId: result.messageId,
          txHash: transactionResult.txHash
        });
      } else {
        logger.warn('Failed to send sender notification', {
          emailId: originalEmail.id,
          to: originalEmail.from,
          error: result.error
        });
      }

      return result;

    } catch (error) {
      logger.error('Error sending sender notification', {
        emailId: originalEmail.id,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send notification to recipient
   * @param {Object} originalEmail - Original email data
   * @param {Object} transactionResult - Transaction processing result
   * @returns {Promise<Object>} Send result
   */
  async sendRecipientNotification(originalEmail, transactionResult) {
    try {
      const result = await this.emailReplyService.sendRecipientNotification({
        to: originalEmail.recipientEmail,
        senderEmail: originalEmail.from,
        transactionResult: transactionResult,
        originalEmail: originalEmail
      });

      if (result.success) {
        logger.info('Recipient notification sent successfully', {
          emailId: originalEmail.id,
          to: originalEmail.recipientEmail,
          from: originalEmail.from,
          messageId: result.messageId,
          txHash: transactionResult.txHash
        });
      } else {
        logger.warn('Failed to send recipient notification', {
          emailId: originalEmail.id,
          to: originalEmail.recipientEmail,
          error: result.error
        });
      }

      return result;

    } catch (error) {
      logger.error('Error sending recipient notification', {
        emailId: originalEmail.id,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send custom notification
   * @param {Object} options - Notification options
   * @returns {Promise<Object>} Send result
   */
  async sendCustomNotification(options) {
    try {
      if (!this.isInitialized) {
        throw new Error('NotificationService not initialized');
      }

      const {
        to,
        subject,
        htmlBody,
        textBody,
        transactionData = null
      } = options;

      // Use the email reply service to send custom notifications
      const result = await this.emailReplyService.sendCustomEmail({
        to,
        subject,
        htmlBody,
        textBody,
        transactionData
      });

      logger.info('Custom notification sent', {
        to,
        subject,
        success: result.success,
        messageId: result.messageId
      });

      return result;

    } catch (error) {
      logger.error('Error sending custom notification', {
        to: options.to,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      emailReplyService: this.emailReplyService.getStatus()
    };
  }
}

module.exports = NotificationService;
