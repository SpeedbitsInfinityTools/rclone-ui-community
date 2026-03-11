/**
 * Rclone Obscure Package - JavaScript Implementation
 * 
 * Implements Rclone's obscure.MustReveal() function to decrypt obscured client secrets
 * Based on Rclone's fs/config/obscure package (obscure.go)
 * 
 * Algorithm:
 * - Uses AES-CTR encryption with a hardcoded 32-byte key
 * - First 16 bytes are the IV (initialization vector)
 * - Rest is the encrypted ciphertext
 * - Encoded using base64.RawURLEncoding (no padding, uses - and _ instead of + and /)
 */

const crypto = require('crypto');

// Rclone's hardcoded AES encryption key (32 bytes)
// From obscure.go: cryptKey
const CRYPT_KEY = Buffer.from([
    0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d,
    0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b,
    0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12, 0x8a, 0xfb,
    0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38,
]);

const AES_BLOCK_SIZE = 16; // AES block size is 16 bytes

/**
 * Decode base64.RawURLEncoding string
 * base64.RawURLEncoding uses - and _ instead of + and /, and has no padding
 * 
 * @param {string} str - base64.RawURLEncoding string
 * @returns {Buffer} Decoded buffer
 */
function base64RawURLDecode(str) {
    // Convert base64.RawURLEncoding to standard base64
    // Replace - with + and _ with /
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed (base64.RawURLEncoding has no padding)
    const padLength = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(padLength);
    
    return Buffer.from(base64, 'base64');
}

/**
 * AES-CTR encryption/decryption (same operation)
 * 
 * @param {Buffer} out - Output buffer (can be same as input)
 * @param {Buffer} in - Input buffer
 * @param {Buffer} iv - Initialization vector (16 bytes)
 * @throws {Error} If encryption fails
 */
function crypt(out, input, iv) {
    // Create AES cipher with CTR mode
    const cipher = crypto.createCipheriv('aes-256-ctr', CRYPT_KEY, iv);
    
    // Encrypt/decrypt (CTR mode: same operation for both)
    const result = Buffer.concat([
        cipher.update(input),
        cipher.final()
    ]);
    
    // Copy result to output buffer
    result.copy(out);
}

/**
 * Reveal (decrypt) an obscured string
 * This is the JavaScript equivalent of Rclone's obscure.Reveal()
 * 
 * @param {string} obscured - The obscured string to decrypt (base64.RawURLEncoding)
 * @returns {string} The revealed (decrypted) string
 * @throws {Error} If the string cannot be revealed
 */
function reveal(obscured) {
    if (!obscured || typeof obscured !== 'string') {
        throw new Error('Invalid obscured string');
    }
    
    try {
        // Decode from base64.RawURLEncoding
        const ciphertext = base64RawURLDecode(obscured);
        
        // Check minimum length (must have IV + at least some data)
        if (ciphertext.length < AES_BLOCK_SIZE) {
            throw new Error('Input too short when revealing password - is it obscured?');
        }
        
        // Extract IV (first 16 bytes) and encrypted data (rest)
        const iv = ciphertext.slice(0, AES_BLOCK_SIZE);
        const encryptedData = ciphertext.slice(AES_BLOCK_SIZE);
        
        // Create buffer for decrypted data (same size as encrypted data)
        const decryptedData = Buffer.alloc(encryptedData.length);
        
        // Decrypt using AES-CTR (decryption is same as encryption in CTR mode)
        crypt(decryptedData, encryptedData, iv);
        
        // Convert to UTF-8 string
        return decryptedData.toString('utf8');
    } catch (error) {
        if (error.message.includes('base64 decode')) {
            throw new Error(`Base64 decode failed when revealing password - is it obscured?: ${error.message}`);
        }
        throw new Error(`Failed to reveal obscured string: ${error.message}`);
    }
}

/**
 * MustReveal - Reveal an obscured string, throwing an error if it fails
 * This is the JavaScript equivalent of Rclone's obscure.MustReveal()
 * 
 * @param {string} obscured - The obscured string to decrypt
 * @returns {string} The revealed (decrypted) string
 * @throws {Error} If the string cannot be revealed
 */
function mustReveal(obscured) {
    if (!obscured) {
        throw new Error('obscured string is empty');
    }
    const result = reveal(obscured);
    if (!result) {
        throw new Error('Reveal failed: empty result');
    }
    return result;
}

module.exports = {
    reveal,
    mustReveal
};

