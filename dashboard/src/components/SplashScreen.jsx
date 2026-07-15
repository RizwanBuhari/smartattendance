// A brief branded intro shown every time the app loads: the Elsewedy logo
// animates in on the brand-red background, then the whole screen fades away to
// reveal the app. (Plays on full page loads/refreshes, not on in-app nav.)
import { useEffect, useState } from 'react'
import LogoShine from './LogoShine'

export default function SplashScreen() {
  const [show, setShow] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const startFade = setTimeout(() => setLeaving(true), 2300)
    const unmount = setTimeout(() => setShow(false), 2950)
    return () => {
      clearTimeout(startFade)
      clearTimeout(unmount)
    }
  }, [])

  if (!show) return null

  return (
    <div className={`splash${leaving ? ' splash-leaving' : ''}`}>
      <LogoShine
        src="/elsewedy-logo-white.png"
        alt="Elsewedy Electric"
        shine="dark"
        className="splash-logo-wrap"
        imgClassName="splash-logo"
      />
    </div>
  )
}
