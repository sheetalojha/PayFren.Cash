const { ethers } = require('ethers');
const logger = require('../utils/logger');
const config = require('../config/config');

// Import ABIs
const SmartContractWalletABI = require('../../abi/SmartContractWallet.sol/SmartContractWallet.json');
const WalletFactoryABI = require('../../abi/WalletFactory.sol/WalletFactory.json');

class SmartContractService {
  constructor() {
    this.provider = null;
    this.walletFactory = null;
    this.signer = null;
    this.isInitialized = false;
    
    // Contract addresses (should be set via environment variables)
    this.walletFactoryAddress = process.env.WALLET_FACTORY_ADDRESS;
    this.verifierAddress = process.env.VERIFIER_ADDRESS;
    this.privateKey = process.env.PRIVATE_KEY;
    this.rpcUrl = process.env.RPC_URL;
    
    // Initialize the service (async)
    this.initializePromise = this.initialize();
  }

  /**
   * Initialize the smart contract service
   */
  async initialize() {
    try {
      console.log('Initializing SmartContractService...');
      console.log('Configuration:', {
        rpcUrl: this.rpcUrl ? 'Set' : 'Missing',
        privateKey: this.privateKey ? 'Set' : 'Missing',
        walletFactoryAddress: this.walletFactoryAddress || 'Not set',
        verifierAddress: this.verifierAddress || 'Not set'
      });

      if (!this.rpcUrl || !this.privateKey) {
        const missing = [];
        if (!this.rpcUrl) missing.push('RPC_URL');
        if (!this.privateKey) missing.push('PRIVATE_KEY');
        
        console.warn(`SmartContractService not initialized - missing: ${missing.join(', ')}`);
        logger.warn('SmartContractService not initialized', { missing });
        return;
      }

      // Initialize provider and signer
      console.log('Connecting to RPC provider...');
      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
      this.signer = new ethers.Wallet(this.privateKey, this.provider);

      // Test connection
      const network = await this.provider.getNetwork();
      console.log('Connected to network:', network.name, network.chainId);

      // Initialize contract instances
      if (this.walletFactoryAddress) {
        console.log('Initializing WalletFactory contract...');
        this.walletFactory = new ethers.Contract(
          this.walletFactoryAddress,
          WalletFactoryABI.abi,
          this.signer
        );
        console.log('WalletFactory contract initialized');
      } else {
        console.warn('WALLET_FACTORY_ADDRESS not set - wallet operations will not work');
      }

      this.isInitialized = true;
      console.log('SmartContractService initialized successfully!');
      logger.info('SmartContractService initialized successfully', {
        network: this.rpcUrl,
        chainId: network.chainId.toString(),
        walletFactoryAddress: this.walletFactoryAddress,
        verifierAddress: this.verifierAddress
      });

    } catch (error) {
      console.error('Failed to initialize SmartContractService:', error.message);
      logger.error('Failed to initialize SmartContractService', { 
        error: error.message,
        stack: error.stack 
      });
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Generate email hash for wallet mapping
   * @param {string} email - Email address
   * @returns {string} Email hash
   */
  generateEmailHash(email) {
    return ethers.keccak256(ethers.toUtf8Bytes(email.toLowerCase()));
  }

  /**
   * Check if wallet exists for email hash
   * @param {string} emailHash - Email hash
   * @returns {Promise<{exists: boolean, walletAddress?: string, count?: number}>}
   */
  async checkWalletExists(emailHash) {
    if (!this.isInitialized || !this.walletFactory) {
      throw new Error('SmartContractService not initialized');
    }

    try {
      // Try to get wallet count, handle case where no wallets exist
      let walletCount;
      try {
        walletCount = await this.walletFactory.walletsCount(emailHash);
        const count = Number(walletCount);

        if (count > 0) {
          // Get the first wallet for this email hash
          const walletAddress = await this.walletFactory.walletAt(emailHash, 0);
          return {
            exists: true,
            walletAddress,
            count
          };
        }

        return {
          exists: false,
          count: 0
        };
      } catch (contractError) {
        // If contract call fails with BAD_DATA, it likely means no wallets exist
        if (contractError.code === 'BAD_DATA' && contractError.value === '0x') {
          console.log('No wallets found for email hash (contract returned empty data)');
          return {
            exists: false,
            count: 0
          };
        }
        throw contractError;
      }

    } catch (error) {
      logger.error('Error checking wallet existence', { 
        emailHash, 
        error: error.message,
        code: error.code,
        value: error.value
      });
      throw error;
    }
  }

  /**
   * Create a new wallet for email hash
   * @param {string} emailHash - Email hash
   * @param {string} vKey - Verification key
   * @param {string} ownerCommitment - Owner commitment
   * @returns {Promise<{success: boolean, walletAddress?: string, txHash?: string}>}
   */
  async createWallet(emailHash, vKey, ownerCommitment) {
    if (!this.isInitialized || !this.walletFactory) {
      throw new Error('SmartContractService not initialized');
    }

    if (!this.verifierAddress) {
      throw new Error('Verifier address not configured');
    }

    try {
      logger.info('Creating new wallet', { 
        emailHash, 
        verifierAddress: this.verifierAddress 
      });

      const tx = await this.walletFactory.createWallet(
        vKey,
        emailHash,
        this.verifierAddress,
        ownerCommitment,
        {
          gasLimit: 5000000 // Set appropriate gas limit
        }
      );

      logger.info('Wallet creation transaction sent', { txHash: tx.hash });

      // Get the return value from the transaction
      let walletAddress = null;
      try {
        // Try to get the return value from the transaction call
        const result = await this.walletFactory.createWallet.staticCall(
          vKey,
          emailHash,
          this.verifierAddress,
          ownerCommitment
        );
        walletAddress = result;
        console.log('Wallet address from static call:', walletAddress);
      } catch (error) {
        console.log('Failed to get wallet address from static call:', error.message);
      }

      const receipt = await tx.wait();
      
      console.log('Transaction receipt:', {
        status: receipt.status,
        logsCount: receipt.logs.length,
        gasUsed: receipt.gasUsed.toString()
      });
      
      if (receipt.status === 1) {
        // If we didn't get the wallet address from static call, try alternative methods
        if (!walletAddress) {
          console.log('Wallet address not found from static call, trying alternative methods...');
          
          // Method 1: Try to parse events (in case they exist)
          console.log('Parsing transaction logs...');
          for (let i = 0; i < receipt.logs.length; i++) {
            const log = receipt.logs[i];
            console.log(`Log ${i}:`, {
              address: log.address,
              topics: log.topics,
              data: log.data
            });
            
            try {
              const decoded = this.walletFactory.interface.parseLog(log);
              console.log(`Decoded log ${i}:`, {
                name: decoded.name,
                args: decoded.args
              });
              
              if (decoded.name === 'WalletCreated' || decoded.name === 'WalletAdded') {
                walletAddress = decoded.args.wallet;
                console.log(`Found ${decoded.name} event with address:`, walletAddress);
                break;
              }
            } catch (e) {
              console.log(`Failed to decode log ${i}:`, e.message);
            }
          }

          // Method 2: Try to get the wallet address from the walletsCount
          if (!walletAddress) {
            console.log('Trying to get wallet address via walletsCount...');
            try {
              // Wait a moment for the transaction to be fully processed
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              const walletCount = await this.walletFactory.walletsCount(emailHash);
              const count = Number(walletCount);
              console.log('Wallet count after creation:', count);
              
              if (count > 0) {
                walletAddress = await this.walletFactory.walletAt(emailHash, count - 1);
                console.log('Retrieved wallet address via walletsCount:', walletAddress);
              }
            } catch (error) {
              console.log('Alternative method failed:', error.message);
            }
          }
        }

        logger.info('Wallet created successfully', { 
          emailHash, 
          walletAddress, 
          txHash: tx.hash 
        });

        return {
          success: true,
          walletAddress,
          txHash: tx.hash
        };
      } else {
        throw new Error('Transaction failed');
      }

    } catch (error) {
      logger.error('Error creating wallet', { 
        emailHash, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Check wallet balance
   * @param {string} walletAddress - Wallet contract address
   * @returns {Promise<{balance: string, balanceWei: string}>}
   */
  async getWalletBalance(walletAddress) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    try {
      const balanceWei = await this.provider.getBalance(walletAddress);
      const balance = ethers.formatEther(balanceWei);

      return {
        balance,
        balanceWei: balanceWei.toString()
      };

    } catch (error) {
      logger.error('Error getting wallet balance', { 
        walletAddress, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get current nonce for wallet
   * @param {string} walletAddress - Wallet contract address
   * @returns {Promise<number>} Current nonce
   */
  async getCurrentNonce(walletAddress) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    try {
      const walletContract = new ethers.Contract(
        walletAddress,
        SmartContractWalletABI.abi,
        this.provider
      );

      // Since the contract doesn't have a direct nonce getter, we'll use a default value
      // In a real implementation, you might need to track nonces externally
      // or modify the contract to include a nonce getter
      const nonce = 0; // This should be tracked externally or added to the contract
      
      return nonce;

    } catch (error) {
      logger.error('Error getting current nonce', { 
        walletAddress, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Execute transfer from wallet
   * @param {string} walletAddress - Wallet contract address
   * @param {string} recipientAddress - Recipient address
   * @param {string} amount - Amount in ETH (as string)
   * @param {number} nonce - Transaction nonce
   * @param {string} proof - ZK proof bytes
   * @param {string} pubSignals - Public signals bytes
   * @returns {Promise<{success: boolean, txHash?: string}>}
   */
  async executeTransfer(walletAddress, recipientAddress, amount, nonce, proof, pubSignals) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    try {
      const walletContract = new ethers.Contract(
        walletAddress,
        SmartContractWalletABI.abi,
        this.signer
      );

      const amountWei = ethers.parseEther(amount);

      logger.info('Executing transfer', {
        walletAddress,
        recipientAddress,
        amount,
        amountWei: amountWei.toString(),
        nonce
      });

      const tx = await walletContract.executeTransfer(
        recipientAddress,
        amountWei,
        nonce,
        proof,
        pubSignals,
        {
          gasLimit: 5000000 // Set appropriate gas limit
        }
      );

      logger.info('Transfer transaction sent', { txHash: tx.hash });

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        logger.info('Transfer executed successfully', {
          walletAddress,
          recipientAddress,
          amount,
          txHash: tx.hash
        });

        return {
          success: true,
          txHash: tx.hash
        };
      } else {
        throw new Error('Transfer transaction failed');
      }

    } catch (error) {
      logger.error('Error executing transfer', {
        walletAddress,
        recipientAddress,
        amount,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process transaction based on email intent
   * @param {Object} transactionData - Transaction data from email parser
   * @returns {Promise<Object>} Processing result
   */
  async processTransaction(transactionData) {
    try {
      const { senderEmail, amount, currency, recipientEmail } = transactionData;
      
      // Generate email hash for sender
      const emailHash = this.generateEmailHash(senderEmail);
      
      logger.info('Processing transaction', {
        senderEmail,
        emailHash,
        amount,
        currency,
        recipientEmail
      });

      // Check if wallet exists for sender
      const walletCheck = await this.checkWalletExists(emailHash);
      
      if (!walletCheck.exists) {
        // Create new wallet for user
        logger.info('Wallet does not exist, creating new wallet', { emailHash });
        
        // Generate default values for wallet creation
        // In a real implementation, these should be generated properly
        const vKey = ethers.keccak256(ethers.toUtf8Bytes('default-vkey'));
        const ownerCommitment = ethers.keccak256(ethers.toUtf8Bytes(senderEmail));
        
        const createResult = await this.createWallet(emailHash, vKey, ownerCommitment);
        
        if (createResult.success) {
          return {
            success: false,
            action: 'wallet_created',
            message: 'New wallet created but no funds available for transaction',
            walletAddress: createResult.walletAddress,
            txHash: createResult.txHash
          };
        } else {
          throw new Error('Failed to create wallet');
        }
      }

      // Wallet exists, check balance
      const balance = await this.getWalletBalance(walletCheck.walletAddress);
      const balanceEth = parseFloat(balance.balance);
      const transferAmount = parseFloat(amount);

      logger.info('Wallet balance check', {
        walletAddress: walletCheck.walletAddress,
        balance: balance.balance,
        transferAmount: amount
      });

      if (balanceEth < transferAmount) {
        return {
          success: false,
          action: 'insufficient_funds',
          message: `Insufficient funds. Balance: ${balance.balance} ETH, Required: ${amount} ETH`,
          walletAddress: walletCheck.walletAddress,
          balance: balance.balance
        };
      }

      // Get current nonce and prepare for transfer
      const currentNonce = await this.getCurrentNonce(walletCheck.walletAddress);
      const nextNonce = currentNonce + 1;

      // For now, return success with nonce info
      // In a real implementation, you would generate the ZK proof and execute the transfer
      // For demonstration purposes, we'll generate a mock transaction hash
      const mockTxHash = `0x${Math.random().toString(16).substr(2, 64)}`;
      
      return {
        success: true,
        action: 'transfer_ready',
        message: 'Funds sufficient, ready for transfer execution',
        walletAddress: walletCheck.walletAddress,
        recipientEmail,
        amount,
        nonce: nextNonce,
        balance: balance.balance,
        txHash: mockTxHash // Mock transaction hash for demonstration
      };

    } catch (error) {
      logger.error('Error processing transaction', {
        transactionData,
        error: error.message
      });
      throw error;
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
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasProvider: !!this.provider,
      hasWalletFactory: !!this.walletFactory,
      hasSigner: !!this.signer,
      walletFactoryAddress: this.walletFactoryAddress,
      verifierAddress: this.verifierAddress,
      network: this.rpcUrl
    };
  }
}

module.exports = SmartContractService;
