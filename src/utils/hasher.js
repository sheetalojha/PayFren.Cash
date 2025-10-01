const { ethers } = require('ethers');

/**
 * Convert call sign to nonce
 * @param {string} callSign - The call sign string
 * @returns {Promise<number>} Nonce as number
 */
async function callSignToNonce(callSign) {
  try {
    // Convert call sign to bytes and then to number
    const callSignBytes = ethers.toUtf8Bytes(callSign);
    const hash = ethers.keccak256(callSignBytes);
    
    // Convert first 8 bytes of hash to number (to fit in uint256)
    const nonceHex = hash.slice(0, 10); // 0x + 8 bytes = 10 chars
    const nonce = parseInt(nonceHex, 16);
    
    return nonce;
  } catch (error) {
    console.error('Error converting call sign to nonce:', error);
    // Fallback: use timestamp as nonce
    return Date.now();
  }
}

module.exports = {
  callSignToNonce
};