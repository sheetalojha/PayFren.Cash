const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

class EMLStorageService {
  constructor() {
    this.storagePath = config.storage.emlPath;
    this.maxStorageSize = config.storage.maxStorageSize;
    this.cleanupInterval = config.storage.cleanupInterval;
    this.ensureStorageDirectory();
    this.startCleanupScheduler();
  }

  /**
   * Ensure storage directory exists
   */
  async ensureStorageDirectory() {
    try {
      await fs.access(this.storagePath);
    } catch (error) {
      await fs.mkdir(this.storagePath, { recursive: true });
      logger.info('Created EML storage directory', { path: this.storagePath });
    }
  }

  /**
   * Save email as EML file
   * @param {String} emailId - Unique email identifier
   * @param {Buffer} emailBuffer - Raw email buffer
   * @param {Object} metadata - Email metadata
   * @returns {Promise<String>} Path to saved EML file
   */
  async saveEML(emailId, emailBuffer, metadata = {}) {
    try {
      await this.ensureStorageDirectory();
      
      // Create filename with timestamp and email ID
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}_${emailId}.eml`;
      const filePath = path.join(this.storagePath, filename);

      // Save the raw email buffer
      await fs.writeFile(filePath, emailBuffer);

      // Save metadata as JSON file
      const metadataPath = path.join(this.storagePath, `${timestamp}_${emailId}.json`);
      const metadataContent = {
        emailId,
        filename,
        filePath,
        metadataPath,
        savedAt: new Date().toISOString(),
        size: emailBuffer.length,
        ...metadata
      };

      await fs.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2));

      logger.emailSaved(emailId, filePath);
      
      return filePath;
    } catch (error) {
      logger.emailError(emailId, error, { context: 'eml_save' });
      throw new Error(`Failed to save EML file: ${error.message}`);
    }
  }

  /**
   * Download EML file by email ID
   * @param {String} emailId - Email identifier
   * @returns {Promise<Buffer>} EML file content
   */
  async downloadEML(emailId) {
    try {
      const files = await fs.readdir(this.storagePath);
      const emlFile = files.find(file => file.includes(emailId) && file.endsWith('.eml'));
      
      if (!emlFile) {
        throw new Error(`EML file not found for email ID: ${emailId}`);
      }

      const filePath = path.join(this.storagePath, emlFile);
      const content = await fs.readFile(filePath);
      
      logger.info('EML file downloaded', { emailId, filePath });
      return content;
    } catch (error) {
      logger.emailError(emailId, error, { context: 'eml_download' });
      throw new Error(`Failed to download EML file: ${error.message}`);
    }
  }

  /**
   * Get EML file metadata
   * @param {String} emailId - Email identifier
   * @returns {Promise<Object>} EML file metadata
   */
  async getEMLMetadata(emailId) {
    try {
      const files = await fs.readdir(this.storagePath);
      const metadataFile = files.find(file => file.includes(emailId) && file.endsWith('.json'));
      
      if (!metadataFile) {
        throw new Error(`Metadata file not found for email ID: ${emailId}`);
      }

      const filePath = path.join(this.storagePath, metadataFile);
      const content = await fs.readFile(filePath, 'utf8');
      const metadata = JSON.parse(content);
      
      return metadata;
    } catch (error) {
      logger.emailError(emailId, error, { context: 'eml_metadata' });
      throw new Error(`Failed to get EML metadata: ${error.message}`);
    }
  }

  /**
   * List all EML files with metadata
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of EML files with metadata
   */
  async listEMLFiles(options = {}) {
    try {
      const files = await fs.readdir(this.storagePath);
      const emlFiles = files.filter(file => file.endsWith('.eml'));
      
      const results = [];
      
      for (const emlFile of emlFiles) {
        const emailId = emlFile.split('_').slice(1).join('_').replace('.eml', '');
        const metadataFile = emlFile.replace('.eml', '.json');
        
        try {
          const metadataPath = path.join(this.storagePath, metadataFile);
          const metadataContent = await fs.readFile(metadataPath, 'utf8');
          const metadata = JSON.parse(metadataContent);
          
          // Apply filters if provided
          if (options.from && metadata.from !== options.from) continue;
          if (options.to && !metadata.to.includes(options.to)) continue;
          if (options.dateFrom && new Date(metadata.savedAt) < new Date(options.dateFrom)) continue;
          if (options.dateTo && new Date(metadata.savedAt) > new Date(options.dateTo)) continue;
          
          results.push({
            emailId,
            filename: emlFile,
            ...metadata
          });
        } catch (error) {
          logger.warn('Failed to read metadata for EML file', { emlFile, error: error.message });
        }
      }
      
      // Sort by savedAt date (newest first)
      results.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
      
      // Apply pagination
      if (options.limit) {
        const offset = options.offset || 0;
        return results.slice(offset, offset + options.limit);
      }
      
      return results;
    } catch (error) {
      logger.error('Failed to list EML files', { error: error.message });
      throw new Error(`Failed to list EML files: ${error.message}`);
    }
  }

  /**
   * Delete EML file and its metadata
   * @param {String} emailId - Email identifier
   * @returns {Promise<Boolean>} True if deleted successfully
   */
  async deleteEML(emailId) {
    try {
      const files = await fs.readdir(this.storagePath);
      const emlFile = files.find(file => file.includes(emailId) && file.endsWith('.eml'));
      const metadataFile = files.find(file => file.includes(emailId) && file.endsWith('.json'));
      
      if (!emlFile) {
        throw new Error(`EML file not found for email ID: ${emailId}`);
      }

      const emlPath = path.join(this.storagePath, emlFile);
      await fs.unlink(emlPath);
      
      if (metadataFile) {
        const metadataPath = path.join(this.storagePath, metadataFile);
        await fs.unlink(metadataPath);
      }
      
      logger.info('EML file deleted', { emailId });
      return true;
    } catch (error) {
      logger.emailError(emailId, error, { context: 'eml_delete' });
      throw new Error(`Failed to delete EML file: ${error.message}`);
    }
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>} Storage statistics
   */
  async getStorageStats() {
    try {
      const files = await fs.readdir(this.storagePath);
      const emlFiles = files.filter(file => file.endsWith('.eml'));
      
      let totalSize = 0;
      let oldestFile = null;
      let newestFile = null;
      
      for (const file of emlFiles) {
        const filePath = path.join(this.storagePath, file);
        const stats = await fs.stat(filePath);
        
        totalSize += stats.size;
        
        if (!oldestFile || stats.birthtime < oldestFile.birthtime) {
          oldestFile = { filename: file, birthtime: stats.birthtime };
        }
        
        if (!newestFile || stats.birthtime > newestFile.birthtime) {
          newestFile = { filename: file, birthtime: stats.birthtime };
        }
      }
      
      return {
        totalFiles: emlFiles.length,
        totalSize,
        totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        maxStorageSizeMB: Math.round(this.maxStorageSize / (1024 * 1024) * 100) / 100,
        usagePercentage: Math.round((totalSize / this.maxStorageSize) * 100),
        oldestFile,
        newestFile,
        storagePath: this.storagePath
      };
    } catch (error) {
      logger.error('Failed to get storage stats', { error: error.message });
      throw new Error(`Failed to get storage stats: ${error.message}`);
    }
  }

  /**
   * Clean up old files based on storage limits
   */
  async cleanupOldFiles() {
    try {
      const stats = await this.getStorageStats();
      
      if (stats.usagePercentage > 90) {
        logger.warn('Storage usage is high, starting cleanup', { usagePercentage: stats.usagePercentage });
        
        const files = await this.listEMLFiles();
        const filesToDelete = files.slice(Math.floor(files.length * 0.1)); // Delete oldest 10%
        
        for (const file of filesToDelete) {
          await this.deleteEML(file.emailId);
        }
        
        logger.info('Storage cleanup completed', { deletedFiles: filesToDelete.length });
      }
    } catch (error) {
      logger.error('Storage cleanup failed', { error: error.message });
    }
  }

  /**
   * Start cleanup scheduler
   */
  startCleanupScheduler() {
    setInterval(() => {
      this.cleanupOldFiles();
    }, this.cleanupInterval);
    
    logger.info('Storage cleanup scheduler started', { interval: this.cleanupInterval });
  }

  /**
   * Export EML file as downloadable format
   * @param {String} emailId - Email identifier
   * @returns {Promise<Object>} Export data with content and headers
   */
  async exportEML(emailId) {
    try {
      const content = await this.downloadEML(emailId);
      const metadata = await this.getEMLMetadata(emailId);
      
      return {
        content,
        filename: metadata.filename,
        contentType: 'message/rfc822',
        size: content.length,
        metadata
      };
    } catch (error) {
      logger.emailError(emailId, error, { context: 'eml_export' });
      throw new Error(`Failed to export EML file: ${error.message}`);
    }
  }

  /**
   * Delete EML file and metadata after successful processing
   * @param {String} emailId - Email identifier
   * @returns {Promise<boolean>} Success status
   */
  async deleteEML(emailId) {
    try {
      // Find the EML file by email ID
      const files = await fs.readdir(this.storagePath);
      const emlFile = files.find(file => file.includes(emailId) && file.endsWith('.eml'));
      const jsonFile = files.find(file => file.includes(emailId) && file.endsWith('.json'));

      if (!emlFile) {
        logger.warn('EML file not found for deletion', { emailId });
        return false;
      }

      const emlPath = path.join(this.storagePath, emlFile);
      const jsonPath = jsonFile ? path.join(this.storagePath, jsonFile) : null;

      // Delete EML file
      await fs.unlink(emlPath);
      logger.info('EML file deleted', { emailId, emlPath });

      // Delete JSON metadata file if it exists
      if (jsonPath && await fs.access(jsonPath).then(() => true).catch(() => false)) {
        await fs.unlink(jsonPath);
        logger.info('EML metadata file deleted', { emailId, jsonPath });
      }

      return true;

    } catch (error) {
      logger.error('Error deleting EML file', { 
        emailId, 
        error: error.message 
      });
      return false;
    }
  }
}

module.exports = EMLStorageService;
