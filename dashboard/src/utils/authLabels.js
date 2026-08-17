// Formatters to convert raw auth methods and fallback reasons to clean, human-readable labels.

export function formatAuthMethod(raw) {
  if (!raw) return 'Device Authentication'
  const val = String(raw).toLowerCase().trim()
  if (val.includes('strict_face') || val.includes('system_face') || val.includes('face')) {
    return 'Face Authentication'
  }
  if (val.includes('strict_fingerprint') || val.includes('fingerprint')) {
    return 'Fingerprint'
  }
  if (val === 'device_credential' || val.includes('pin') || val.includes('pattern') || val.includes('password') || val.includes('pass')) {
    return 'Device PIN, Pattern or Password'
  }
  if (val === 'device_authentication' || val.includes('device_auth')) {
    return 'Device Authentication'
  }
  return 'Device Authentication'
}

export function formatFallbackReason(raw) {
  if (!raw) return 'assigned method was unavailable'
  const val = String(raw).toLowerCase().trim()
  if (val.includes('face_not_supported') || val.includes('face_unavailable')) {
    return 'Face Authentication was unavailable'
  }
  if (val.includes('face_not_enrolled')) {
    return 'Face Authentication is not configured'
  }
  if (val.includes('fingerprint_not_supported') || val.includes('fingerprint_unavailable')) {
    return 'Fingerprint is not supported'
  }
  if (val.includes('fingerprint_not_enrolled')) {
    return 'Fingerprint is not configured'
  }
  if (val.includes('fingerprint_locked_out')) {
    return 'Fingerprint was temporarily locked'
  }
  if (val.includes('device_lock_not_configured')) {
    return 'Device lock is not configured'
  }
  return 'assigned method was unavailable'
}
