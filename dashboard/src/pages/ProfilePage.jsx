// The admin's own profile — account details from their Firebase login plus
// editable fields (name, job title, phone, photo) stored in the admins doc.
import { useEffect, useState } from 'react'
import { sendPasswordResetEmail, updateProfile } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuth } from '../auth/AuthContext'
import { getMyProfile, updateMyProfile } from '../services/adminService'
import Spinner from '../components/Spinner'
import PageHead from '../components/PageHead'
import { Icon } from '../components/icons'

function initials(str = '') {
  const parts = str.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0].toUpperCase()).join('') || '?'
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

// Resize an image file to a small square thumbnail data URL, keeping the
// Firestore document comfortably under its 1 MB limit.
function fileToThumbnail(file, size = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const emptyForm = { displayName: '', phone: '', jobTitle: '', photoBase64: '' }

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    getMyProfile()
      .then((p) => {
        const data = p || {}
        setProfile(data)
        setForm({
          displayName: data.displayName || '',
          phone: data.phone || '',
          jobTitle: data.jobTitle || '',
          photoBase64: data.photoBase64 || '',
        })
      })
      .catch(() => setProfile({}))
  }, [])

  if (!user) return null

  const name =
    form.displayName ||
    user.displayName ||
    user.email?.split('@')[0] ||
    'Admin'
  const photo = form.photoBase64

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const thumb = await fileToThumbnail(file)
      setForm((f) => ({ ...f, photoBase64: thumb }))
    } catch {
      setMessage('Could not read that image.')
    }
  }

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const updated = await updateMyProfile(form)
      setProfile(updated)
      // Keep the Firebase Auth display name in sync.
      if (auth.currentUser && form.displayName !== (user.displayName || '')) {
        await updateProfile(auth.currentUser, { displayName: form.displayName })
      }
      setEditing(false)
      setMessage('Profile saved.')
    } catch {
      setMessage('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setForm({
      displayName: profile?.displayName || '',
      phone: profile?.phone || '',
      jobTitle: profile?.jobTitle || '',
      photoBase64: profile?.photoBase64 || '',
    })
    setEditing(false)
    setMessage('')
  }

  async function changePassword() {
    setMessage('')
    try {
      await sendPasswordResetEmail(auth, user.email)
      setMessage(`Password reset link sent to ${user.email}.`)
    } catch {
      setMessage('Could not send the reset email.')
    }
  }

  return (
    <div className="reveal">
      <PageHead
        icon={Icon.user}
        title="Profile"
        hint="Your admin account details."
        action={
          !editing && (
            <button
              className="btn-sm btn-sm-primary"
              onClick={() => setEditing(true)}
            >
              Edit profile
            </button>
          )
        }
      />

      <div className="panel profile-card">
        <div className="profile-header">
          <div className="profile-avatar-wrap">
            {photo ? (
              <img className="profile-photo" src={photo} alt={name} />
            ) : (
              <span className="profile-avatar">{initials(name)}</span>
            )}
            {editing && (
              <label className="profile-photo-edit">
                Change photo
                <input type="file" accept="image/*" onChange={onPhoto} hidden />
              </label>
            )}
          </div>
          <div>
            <div className="profile-name">{name}</div>
            <div className="profile-email">{user.email}</div>
            <span className="badge badge-ontime">Administrator</span>
          </div>
        </div>

        {editing ? (
          <div className="profile-form">
            <label>
              Display name
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="e.g. Ahmed Hany"
              />
            </label>
            <label>
              Job title
              <input
                type="text"
                value={form.jobTitle}
                onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                placeholder="e.g. HR Administrator"
              />
            </label>
            <label>
              Phone
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="e.g. +971 50 123 4567"
              />
            </label>
          </div>
        ) : (
          <dl className="profile-details">
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Job title</dt>
              <dd>{profile?.jobTitle || '—'}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{profile?.phone || '—'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>Administrator</dd>
            </div>
            <div>
              <dt>Email verified</dt>
              <dd>{user.emailVerified ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{formatDate(user.metadata?.creationTime)}</dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{formatDate(user.metadata?.lastSignInTime)}</dd>
            </div>
            <div>
              <dt>User ID</dt>
              <dd className="profile-mono">{user.uid}</dd>
            </div>
          </dl>
        )}

        {message && <div className="profile-message">{message}</div>}

        <div className="row-actions">
          {editing ? (
            <>
              <button
                className="btn-sm btn-sm-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Spinner light /> Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
              <button className="btn-sm" onClick={cancel} disabled={saving}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn-sm" onClick={changePassword}>
                Change password
              </button>
              <button className="btn-sm btn-sm-danger" onClick={logout}>
                Log out
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
