/**
 * Detect user's operating system and CPU architecture
 * @returns {Object} { os: 'windows'|'macos'|'linux', arch: 'x64'|'arm64'|'universal' }
 */
export function detectSystem() {
    const ua = navigator.userAgent;
    
    // Debug: Log User-Agent for troubleshooting (remove in production if needed)
    console.log('[System Detection] User-Agent:', ua);
    if (navigator.userAgentData) {
        console.log('[System Detection] userAgentData:', navigator.userAgentData);
    }
    
    // OS Detection
    let os = 'unknown';
    if (/Win/.test(ua)) {
        os = 'windows';
    } else if (/Mac/.test(ua)) {
        os = 'macos';
    } else if (/Linux|X11/.test(ua)) {
        os = 'linux';
    }
    
    // Architecture Detection
    let arch = 'x64'; // Default assumption
    
    // Windows-specific architecture detection (more reliable)
    if (os === 'windows') {
        // Priority 1: Check for explicit ARM64 in Windows context
        // Windows ARM User-Agent typically contains: "Windows NT 10.0; ARM64" or "ARM64;"
        if (/ARM64|Windows.*ARM64|ARM64.*Windows/i.test(ua)) {
            arch = 'arm64';
        }
        // Priority 2: Modern API check (Chrome 90+, Edge 90+)
        else if (navigator.userAgentData) {
            // Check platform property (synchronous)
            const platform = navigator.userAgentData.platform.toLowerCase();
            if (platform.includes('arm')) {
                arch = 'arm64';
            }
            // Also check ua.platform if available
            else if (navigator.userAgentData.uaPlatform && navigator.userAgentData.uaPlatform.toLowerCase().includes('arm')) {
                arch = 'arm64';
            }
        }
        // Priority 3: Check for ARM patterns (but be careful not to match x64)
        else if (/ARM[^x]|arm64|aarch64/i.test(ua) && !/x64|Win64|WOW64/i.test(ua)) {
            // Only set ARM if we don't see x64 indicators
            arch = 'arm64';
        }
        // Priority 4: Check for x64/64-bit Windows (default fallback)
        else if (/Win64|WOW64|x64/i.test(ua)) {
            arch = 'x64';
        }
        // Default: assume x64 if nothing matches
    }
    // macOS - always use universal (works for both Intel and Apple Silicon)
    else if (os === 'macos') {
        arch = 'universal';
    }
    // Linux architecture detection
    else if (os === 'linux') {
        if (/ARM64|arm64|aarch64/i.test(ua)) {
            arch = 'arm64';
        } else if (/x86_64|x64|amd64/i.test(ua)) {
            arch = 'x64';
        }
    }
    
    const result = { os, arch };
    console.log('[System Detection] Detected:', result);
    return result;
}

/**
 * Check if a download row matches the user's system
 * @param {string} platform - Platform identifier (e.g., 'windows-x64', 'macos-universal')
 * @param {Object} system - System detection result
 * @returns {boolean}
 */
export function matchesSystem(platform, system) {
    const { os, arch } = system;
    
    // macOS Universal matches all macOS systems
    if (platform === 'macos-universal' && os === 'macos') {
        return true;
    }
    
    // Check exact match
    const platformParts = platform.split('-');
    const platformOS = platformParts[0];
    const platformArch = platformParts[1];
    
    if (platformOS !== os) {
        return false;
    }
    
    // For Windows: Highlight both x64 and ARM64 if we can't reliably detect ARM
    // (Firefox on Windows ARM often shows "Win64; x64" in User-Agent)
    if (os === 'windows') {
        // If we detected ARM64 with high confidence, only highlight ARM64
        const ua = navigator.userAgent;
        const hasConfidentARM = /ARM64|Windows.*ARM64/i.test(ua) || 
                                 (navigator.userAgentData && navigator.userAgentData.platform && 
                                  navigator.userAgentData.platform.toLowerCase().includes('arm'));
        
        if (hasConfidentARM && arch === 'arm64') {
            return platformArch === 'arm64';
        }
        
        // Otherwise, highlight both Windows options (x64 and ARM64)
        return platformArch === 'x64' || platformArch === 'arm64';
    }
    
    // For Linux, check architecture
    if (os === 'linux') {
        return platformArch === arch || (platformArch === 'x64' && arch !== 'arm64');
    }
    
    return false;
}
