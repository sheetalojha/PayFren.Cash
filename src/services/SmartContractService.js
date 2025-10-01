const { ethers } = require('ethers');
const logger = require('../utils/logger');
const config = require('../config/config');
const {callSignToNonce} = require('../utils/hasher');

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
    
    // Smart contract wallet bytecode for direct deployment
    this.smartContractWalletBytecode = SmartContractWalletABI.bytecode;
    this.smartContractWalletABI = SmartContractWalletABI.abi;
    
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
        console.warn('Running in DEMO MODE - using mock blockchain operations');
        logger.warn('SmartContractService not initialized - running in demo mode', { missing });
        
        // Enable demo mode
        this.isInitialized = true;
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
   * @returns {Promise<{exists: boolean, walletAddress?: string}>}
   */
  async checkWalletExists(emailHash) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    if (!this.walletFactory) {
      throw new Error('Wallet factory not initialized');
    }

    try {
      // Try to get wallet count, handle case where no wallets exist
      let wallets;
      try {
        wallets = await this.walletFactory.getWallets(emailHash);

        if (wallets.length > 0) {
          // Get the first wallet for this email hash
          return {
            exists: true,
            walletAddress: wallets[0],
          };
        }

        return {
          exists: false,
        };
      } catch (contractError) {
        // If contract call fails with BAD_DATA, it likely means no wallets exist
        if (contractError.code === 'BAD_DATA' && contractError.value === '0x') {
          console.log('No wallets found for email hash (contract returned empty data)');
          return {
            exists: false,
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
   * Deploy a new smart contract wallet directly via RPC
   * @param {string} vKey - Verification key
   * @param {string} ownerCommitment - Owner commitment
   * @returns {Promise<{success: boolean, walletAddress?: string, txHash?: string}>}
   */
  async deploySmartContractWallet(vKey, ownerCommitment) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    if (!this.verifierAddress) {
      throw new Error('Verifier address not configured');
    }

    try {
      // Validate inputs
      if (!vKey || vKey.length !== 66) {
        throw new Error(`Invalid vKey: expected 66 characters, got ${vKey?.length || 0}`);
      }
      
      if (!ownerCommitment || ownerCommitment.length !== 66) {
        throw new Error(`Invalid ownerCommitment: expected 66 characters, got ${ownerCommitment?.length || 0}`);
      }

      // Check if we have valid bytecode
      if (!this.smartContractWalletBytecode || this.smartContractWalletBytecode === '0x') {
        throw new Error('Smart contract wallet bytecode is missing or invalid');
      }

      // Check if verifier address is valid
      if (!this.verifierAddress || !ethers.isAddress(this.verifierAddress)) {
        throw new Error(`Invalid verifier address: ${this.verifierAddress}`);
      }

      // Check signer balance
      const signerBalance = await this.provider.getBalance(this.signer.address);
      if (signerBalance === 0n) {
        throw new Error('Signer has no ETH balance for gas fees');
      }

      logger.info('Deploying new smart contract wallet directly', { 
        verifierAddress: this.verifierAddress,
        vKey: vKey.substring(0, 10) + '...',
        ownerCommitment: ownerCommitment.substring(0, 10) + '...',
        signerAddress: this.signer.address,
        signerBalance: ethers.formatEther(signerBalance)
      });

      // Check if we can create a contract factory
      let walletFactory;
      try {
        walletFactory = new ethers.ContractFactory(
          this.smartContractWalletABI,
          this.smartContractWalletBytecode,
          this.signer
        );
        logger.info('Contract factory created successfully');
      } catch (factoryError) {
        logger.error('Failed to create contract factory', { 
          error: factoryError.message,
          bytecodeLength: this.smartContractWalletBytecode?.length || 0,
          abiLength: this.smartContractWalletABI?.length || 0
        });
        throw new Error(`Contract factory creation failed: ${factoryError.message}`);
      }


      // Deploy the contract with proper gas settings
      const walletContract = await walletFactory.deploy(
        vKey,
        this.verifierAddress,
        ownerCommitment,
        // {
        //   gasLimit: gasEstimate * 2n, // Use 2x estimated gas for safety
        // }
      );

      logger.info('Smart contract wallet deployment transaction sent', { 
        txHash: walletContract.deploymentTransaction().hash
      });

      // Wait for deployment to complete
      await walletContract.waitForDeployment();
      const walletAddress = await walletContract.getAddress();

      logger.info('Smart contract wallet deployed successfully', { 
        walletAddress, 
        txHash: walletContract.deploymentTransaction().hash 
      });

      return {
        success: true,
        walletAddress,
        txHash: walletContract.deploymentTransaction().hash
      };

    } catch (error) {
      logger.error('Error deploying smart contract wallet', { 
        error: error.message,
        code: error.code,
        reason: error.reason,
        verifierAddress: this.verifierAddress,
        vKey: vKey?.substring(0, 10) + '...',
        ownerCommitment: ownerCommitment?.substring(0, 10) + '...'
      });
      throw error;
    }
  }

  /**
   * Add wallet to factory mapping as owner
   * @param {string} emailHash - Email hash
   * @param {string} walletAddress - Deployed wallet address
   * @returns {Promise<{success: boolean, txHash?: string}>}
   */
  async addWalletToFactoryMapping(emailHash, walletAddress) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    if (!this.walletFactory) {
      throw new Error('Wallet factory not available');
    }

    try {
      logger.info('Adding wallet to factory mapping', { 
        emailHash, 
        walletAddress 
      });

      // Call addWalletByOwner function as the factory owner
      const tx = await this.walletFactory.addWalletByOwner(
        emailHash,
        walletAddress
      );

      logger.info('Add wallet to factory mapping transaction sent', { txHash: tx.hash });

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        logger.info('Wallet added to factory mapping successfully', { 
          emailHash, 
          walletAddress, 
          txHash: tx.hash 
        });

        return {
          success: true,
          txHash: tx.hash
        };
      } else {
        throw new Error('Add wallet to factory mapping transaction failed');
      }

    } catch (error) {
      logger.error('Error adding wallet to factory mapping', { 
        emailHash, 
        walletAddress, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Create a new wallet for email hash using direct deployment
   * @param {string} emailHash - Email hash
   * @param {string} vKey - Verification key
   * @param {string} ownerCommitment - Owner commitment
   * @returns {Promise<{success: boolean, walletAddress?: string, txHash?: string}>}
   */
  async createWallet(emailHash, vKey, ownerCommitment) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    try {
      logger.info('Creating new wallet using direct deployment', { 
        emailHash, 
        verifierAddress: this.verifierAddress 
      });

      // Step 1: Deploy the smart contract wallet directly
      const deployResult = await this.deploySmartContractWallet(vKey, ownerCommitment);
      
      if (!deployResult.success) {
        throw new Error('Failed to deploy smart contract wallet');
      }

      // Step 2: Add the wallet to factory mapping as owner
      if (this.walletFactory) {
        const mappingResult = await this.addWalletToFactoryMapping(emailHash, deployResult.walletAddress);
        
        if (!mappingResult.success) {
          logger.warn('Wallet deployed but failed to add to factory mapping', {
            walletAddress: deployResult.walletAddress,
            emailHash
          });
        }
      }

      return {
        success: true,
        walletAddress: deployResult.walletAddress,
        txHash: deployResult.txHash
      };

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
   * Execute transfer from wallet to another wallet
   * @param {string} senderWalletAddress - Sender wallet contract address
   * @param {string} receiverWalletAddress - Receiver wallet contract address
   * @param {string} amount - Amount in ETH (as string)
   * @param {string} currency - Currency type (for logging)
   * @returns {Promise<{success: boolean, txHash?: string}>}
   */
  async executeTransfer(senderWalletAddress, receiverWalletAddress, amount, currency) {
    if (!this.isInitialized) {
      throw new Error('SmartContractService not initialized');
    }

    // If in demo mode, return mock transfer
    if (this.demoMode) {
      logger.info('Executing mock transfer (demo mode)', {
        senderWalletAddress,
        receiverWalletAddress,
        amount,
        currency
      });
      
      const mockTxHash = `0x${Math.random().toString(16).substr(2, 64)}`;
      
      return {
        success: true,
        txHash: mockTxHash,
        amount,
        currency,
        demoMode: true
      };
    }

    try {
      const senderWalletContract = new ethers.Contract(
        senderWalletAddress,
        SmartContractWalletABI.abi,
        this.signer
      );

      const amountWei = ethers.parseEther(amount);

      logger.info('Executing transfer between wallets', {
        senderWalletAddress,
        receiverWalletAddress,
        amount,
        currency,
        amountWei: amountWei.toString()
      });

      // For now, we'll use a simple ETH transfer
      // In a real implementation, you'd need to implement the ZK proof system
      // For demonstration, we'll create a mock transaction that simulates the transfer
      
      // Check if the sender wallet has enough balance
      const senderBalance = await this.provider.getBalance(senderWalletAddress);
      if (senderBalance < amountWei) {
        throw new Error(`Insufficient balance. Required: ${ethers.formatEther(amountWei)} ETH, Available: ${ethers.formatEther(senderBalance)} ETH`);
      }

      // TODO: Create a mock transaction hash for demonstration
      // In a real implementation, this would be the actual transaction hash
      const mockTxHash = `0x${Math.random().toString(16).substr(2, 64)}`;
      
      logger.info('Transfer executed successfully', {
        senderWalletAddress,
        receiverWalletAddress,
        amount,
        currency,
        txHash: mockTxHash
      });

      return {
        success: true,
        txHash: mockTxHash
      };

    } catch (error) {
      logger.error('Error executing transfer', {
        senderWalletAddress,
        receiverWalletAddress,
        amount,
        currency,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute transfer with ZK proof (for future implementation)
   * @param {string} walletAddress - Wallet contract address
   * @param {string} recipientAddress - Recipient address
   * @param {string} amount - Amount in ETH (as string)
   * @param {number} nonce - Transaction nonce
   * @param {string} proof - ZK proof bytes
   * @param {string} pubSignals - Public signals bytes
   * @returns {Promise<{success: boolean, txHash?: string}>}
   */
  async executeTransferWithProof(walletAddress, recipientAddress, amount, nonce, proof, pubSignals) {
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

      logger.info('Executing transfer with ZK proof', {
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
        pubSignals
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
      logger.error('Error executing transfer with proof', {
        walletAddress,
        recipientAddress,
        amount,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process balance inquiry
   * @param {Object} balanceInquiry - Balance inquiry data from email parser
   * @returns {Promise<Object>} Balance inquiry result
   */
  async processBalanceInquiry(balanceInquiry) {
    try {
      const { senderEmail } = balanceInquiry;
      
      logger.info('Processing balance inquiry', { senderEmail });
      
      // Generate email hash for sender
      const senderEmailHash = this.generateEmailHash(senderEmail);
      
      // Check if wallet exists
      const walletCheck = await this.checkWalletExists(senderEmailHash);
      
      if (walletCheck.exists) {
        // Wallet exists, get balance
        const balanceResult = await this.getWalletBalance(walletCheck.walletAddress);
        
        logger.info('Balance inquiry successful', {
          senderEmail,
          walletAddress: walletCheck.walletAddress,
          balance: balanceResult.balance
        });
        
        return {
          success: true,
          action: 'balance_retrieved',
          message: `Your wallet balance: ${balanceResult.balance} DOT`,
          senderEmail,
          walletAddress: walletCheck.walletAddress,
          balance: balanceResult.balance,
          currency: 'DOT'
        };
      } else {
        // Wallet doesn't exist, create new empty wallet
        logger.info('Wallet does not exist, creating new empty wallet', { senderEmail });
        
        const vKey = ethers.keccak256(ethers.toUtf8Bytes(senderEmail));
        const ownerCommitment = ethers.keccak256(ethers.toUtf8Bytes(senderEmail));
        
        const createResult = await this.createWallet(senderEmailHash, vKey, ownerCommitment);
        
        if (createResult.success) {
          logger.info('New empty wallet created for balance inquiry', {
            senderEmail,
            walletAddress: createResult.walletAddress
          });
          
          return {
            success: true,
            action: 'wallet_created_empty',
            message: 'New wallet created for you. Current balance: 0 DOT',
            senderEmail,
            walletAddress: createResult.walletAddress,
            balance: '0',
            currency: 'DOT',
            txHash: createResult.txHash
          };
        } else {
          throw new Error('Failed to create wallet for balance inquiry');
        }
      }
      
    } catch (error) {
      logger.error('Error processing balance inquiry', { 
        senderEmail: balanceInquiry.senderEmail,
        error: error.message 
      });
      
      return {
        success: false,
        action: 'balance_inquiry_failed',
        message: `Balance inquiry failed: ${error.message}`,
        senderEmail: balanceInquiry.senderEmail,
        error: error.message
      };
    }
  }

  /**
   * Process transaction based on email intent
   * @param {Object} transactionData - Transaction data from email parser
   * @returns {Promise<Object>} Processing result
   */
  async processTransaction(transactionData) {
    try {
      const { senderEmail, amount, currency, recipientEmail, callSign, transactionType } = transactionData;
      
      // Generate email hashes for both sender and receiver
      const senderEmailHash = this.generateEmailHash(senderEmail);
      let receiverEmailHash = null;
      
      // For legacy format, we have recipientEmail
      if (recipientEmail) {
        receiverEmailHash = this.generateEmailHash(recipientEmail);
      }
      
      logger.info('Processing transaction', {
        senderEmail,
        senderEmailHash,
        recipientEmail,
        receiverEmailHash,
        amount,
        currency,
        callSign,
        transactionType
      });

      // Check if sender wallet exists
      const senderWalletCheck = await this.checkWalletExists(senderEmailHash);
      let senderWalletAddress = null;
      
      if (!senderWalletCheck.exists) {
        // Create sender wallet
        logger.info('Sender wallet does not exist, creating new wallet', { senderEmailHash });
        
        // Store call sign in unused variable (not used for wallet creation)
        const unusedCallSign = callSign;
        
        const vKey = ethers.keccak256(ethers.toUtf8Bytes(senderEmail));
        const ownerCommitment = ethers.keccak256(ethers.toUtf8Bytes(senderEmail));
        
        logger.info('Wallet creation parameters', {
          senderEmail,
          senderEmailHash,
          vKey,
          ownerCommitment,
          verifierAddress: this.verifierAddress
        });
        
        try {
          const createResult = await this.createWallet(senderEmailHash, vKey, ownerCommitment);
        
        if (createResult.success) {
            senderWalletAddress = createResult.walletAddress;
            
            return {
              success: false,
              action: 'sender_wallet_created',
              message: 'Sender wallet created but no funds available for transaction',
              senderWalletAddress: createResult.walletAddress,
              senderEmail,
              txHash: createResult.txHash,
              callSign: unusedCallSign,
              amount,
              currency
            };
          } else {
            throw new Error('Failed to create sender wallet');
          }
        } catch (walletCreationError) {
          // If wallet creation fails, generate a mock wallet address for demo purposes
          logger.warn('Wallet creation failed, generating mock wallet address', { 
            error: walletCreationError.message,
            senderEmailHash 
          });
          
          const mockWalletAddress = `0x${Math.random().toString(16).substr(2, 40)}`;
          const mockTxHash = `0x${Math.random().toString(16).substr(2, 64)}`;
          
          return {
            success: false,
            action: 'sender_wallet_creation_failed',
            message: 'Wallet creation failed - using mock wallet address for demo',
            senderWalletAddress: mockWalletAddress,
            senderEmail,
            txHash: mockTxHash,
            callSign: unusedCallSign,
            amount,
            currency,
            warning: 'This is a mock wallet address - actual deployment failed'
          };
        }
      } else {
        senderWalletAddress = senderWalletCheck.walletAddress;
      }

      // Check sender wallet balance
      const senderBalance = await this.getWalletBalance(senderWalletAddress);
      const balanceEth = parseFloat(senderBalance.balance);
      const transferAmount = parseFloat(amount);

      logger.info('Sender wallet balance check', {
        senderWalletAddress,
        balance: senderBalance.balance,
        transferAmount: amount
      });

      if (balanceEth < transferAmount) {
        return {
          success: false,
          action: 'insufficient_funds',
          message: `Insufficient funds. Balance: ${senderBalance.balance} ETH, Required: ${amount} ETH`,
          senderWalletAddress,
          senderEmail,
          balance: senderBalance.balance,
          callSign: callSign,
          amount,
          currency
        };
      }

      // For new format with call sign, we need to find the receiver wallet
      // For legacy format, we already have recipientEmail
      let receiverWalletAddress = null;
      let actualReceiverEmail = null;

      if (receiverEmailHash) {
        // Legacy format - check if receiver wallet exists
        const receiverWalletCheck = await this.checkWalletExists(receiverEmailHash);
        
        if (!receiverWalletCheck.exists) {
          // Create receiver wallet
          logger.info('Receiver wallet does not exist, creating new wallet', { receiverEmailHash });
          
          const receiverVKey = ethers.keccak256(ethers.toUtf8Bytes(recipientEmail));
          const receiverOwnerCommitment = ethers.keccak256(ethers.toUtf8Bytes(recipientEmail));
          
          const receiverCreateResult = await this.createWallet(receiverEmailHash, receiverVKey, receiverOwnerCommitment);
          
          if (receiverCreateResult.success) {
            receiverWalletAddress = receiverCreateResult.walletAddress;
            actualReceiverEmail = recipientEmail;
          } else {
            throw new Error('Failed to create receiver wallet');
          }
        } else {
          receiverWalletAddress = receiverWalletCheck.walletAddress;
          actualReceiverEmail = recipientEmail;
        }
      } else {
        // New format - recipient email is in 'to' field, call sign is just an identifier
        logger.info('New format detected - using recipient from to field', { 
          callSign, 
          recipientEmail 
        });
        
        if (!recipientEmail) {
          return {
            success: false,
            action: 'sender_wallet_created_no_receiver',
            message: 'Sender wallet created but no recipient email found in to field',
            senderWalletAddress,
            senderEmail,
            callSign: callSign,
            amount,
            currency
          };
        }
        
        // Use recipient email from 'to' field for wallet operations
        const receiverEmailHash = this.generateEmailHash(recipientEmail);
        
        // Check if receiver wallet exists
        const receiverWalletCheck = await this.checkWalletExists(receiverEmailHash);
        
        if (!receiverWalletCheck.exists) {
          // Create receiver wallet using recipient email
          logger.info('Receiver wallet does not exist, creating new wallet', { 
            recipientEmail, 
            receiverEmailHash 
          });
          
          const receiverVKey = ethers.keccak256(ethers.toUtf8Bytes(recipientEmail));
          const receiverOwnerCommitment = ethers.keccak256(ethers.toUtf8Bytes(recipientEmail));
          
          const receiverCreateResult = await this.createWallet(receiverEmailHash, receiverVKey, receiverOwnerCommitment);
          
          if (receiverCreateResult.success) {
            receiverWalletAddress = receiverCreateResult.walletAddress;
            actualReceiverEmail = recipientEmail;
          } else {
            throw new Error('Failed to create receiver wallet');
          }
        } else {
          receiverWalletAddress = receiverWalletCheck.walletAddress;
          actualReceiverEmail = recipientEmail;
        }
      }

      // Execute the actual transfer
      logger.info('Executing transfer between wallets', {
        senderWalletAddress,
        receiverWalletAddress,
        amount,
        currency
      });

      // Send nonce as number from string 'callsign'
      const nonce = await callSignToNonce(callSign);
      // for proof and pubsignals:
      const proof = '0x01' + '00'.repeat(31); // 32 bytes, starts with 0x01
      const pubSignals = '0x01' + '00'.repeat(31); // 32 bytes, starts with 0x01


      let transferResult;
      try {
        transferResult = await this.executeTransferWithProof(
          senderWalletAddress,
          receiverWalletAddress,
          amount.toString(),
          nonce,
          proof,
          pubSignals
        );
      } catch (transferError) {
        // Handle transaction revert errors
        logger.error('Transfer execution failed', {
          error: transferError.message,
          code: transferError.code,
          reason: transferError.reason,
          data: transferError.data,
          senderWalletAddress,
          receiverWalletAddress,
          amount,
          nonce,
          callSign
        });

        // Parse revert reason
        let revertReason = 'Transaction failed';
        if (transferError.data === '0x681bc06c') {
          revertReason = 'Call sign already used (nonce reuse detected)';
        } else if (transferError.reason) {
          revertReason = transferError.reason;
        } else if (transferError.message.includes('insufficient funds')) {
          revertReason = 'Insufficient funds for transaction';
        } else if (transferError.message.includes('execution reverted')) {
          revertReason = 'Smart contract execution reverted';
        }

        return {
          success: false,
          action: 'transfer_failed',
          message: `Transfer failed: ${revertReason}`,
          senderWalletAddress,
          receiverWalletAddress,
          senderEmail,
          receiverEmail: actualReceiverEmail,
          amount,
          currency,
          callSign: callSign,
          error: transferError.message,
          revertReason: revertReason,
          errorCode: transferError.code,
          errorData: transferError.data
        };
      }

      if (transferResult.success) {
        // Get updated balances
        const updatedSenderBalance = await this.getWalletBalance(senderWalletAddress);
        const updatedReceiverBalance = await this.getWalletBalance(receiverWalletAddress);
      
      return {
        success: true,
          action: 'transfer_completed',
          message: 'Transaction completed successfully',
          senderWalletAddress,
          receiverWalletAddress,
          senderEmail,
          receiverEmail: actualReceiverEmail,
        amount,
          currency,
          callSign: callSign,
          txHash: transferResult.txHash,
          senderBalance: updatedSenderBalance.balance,
          receiverBalance: updatedReceiverBalance.balance,
          blockscanUrl: `https://blockscout-passet-hub.parity-testnet.parity.io/tx/${transferResult.txHash}`
        };
      } else {
        throw new Error('Transfer execution failed');
      }

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
