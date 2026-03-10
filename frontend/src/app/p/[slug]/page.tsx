'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface Profile {
  id: string
  slug: string
  name: string
  city: string | null
  address: string | null
  age: number | null
  nationality: string | null
  price_text: string | null
  price_min: number | null
  price_max: number | null
  incall_outcall: string | null
  independent_or_agency: string | null
  services: string[] | null
  availability: string | null
  description: string | null
  photos: string[]
}

function PhotoGallery({ photos }: { photos: string[] }) {
  const [idx, setIdx] = useState(0)
  if (!photos || photos.length === 0) {
    return (
      <div className="w-full aspect-[3/4] bg-zinc-900 flex items-center justify-center">
        <span className="text-zinc-600 text-lg">No photos</span>
      </div>
    )
  }
  return (
    <div className="relative w-full aspect-[3/4] bg-black overflow-hidden">
      <img
        src={photos[idx]}
        alt="Profile photo"
        className="w-full h-full object-cover"
      />
      {photos.length > 1 && (
        <>
          <button
            onClick={() => setIdx(i => (i - 1 + photos.length) % photos.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 rounded-full text-white flex items-center justify-center hover:bg-black/80"
          >
            &lsaquo;
          </button>
          <button
            onClick={() => setIdx(i => (i + 1) % photos.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 rounded-full text-white flex items-center justify-center hover:bg-black/80"
          >
            &rsaquo;
          </button>
          <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
            {idx + 1}/{photos.length}
          </div>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-2 h-2 rounded-full transition-all ${i === idx ? 'bg-pink-500 scale-125' : 'bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const params = useParams()
  const slug = params?.slug as string
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!slug) return
    fetch(`/api/public/profile/${slug}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); setLoading(false); return null }
        return r.json()
      })
      .then(data => {
        if (data) setProfile(data)
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [slug])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-zinc-500">
        Profile not found
      </div>
    )
  }

  const p = profile

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="bg-[#111] border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <span className="text-pink-500 font-bold text-lg tracking-wide">Tahles</span>
        <span className="text-zinc-500 text-xs">PROFILES</span>
      </div>

      <div className="max-w-md mx-auto">
        {/* Photo Gallery */}
        <PhotoGallery photos={p.photos} />

        {/* Name + basics */}
        <div className="px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold text-white mb-1">{p.name}</h1>
          <div className="flex flex-wrap gap-2 text-sm text-zinc-400">
            {p.age && <span>{p.age} years</span>}
            {p.nationality && (
              <>
                {p.age && <span className="text-zinc-600">|</span>}
                <span>{p.nationality}</span>
              </>
            )}
          </div>
          {p.city && (
            <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-400">
              <span className="text-pink-500">&#9679;</span>
              <span>{p.address || p.city}</span>
            </div>
          )}
        </div>

        {/* Tags row */}
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {p.incall_outcall && (
            <span className="bg-pink-500/15 text-pink-400 text-xs font-bold px-3 py-1 rounded-full uppercase">
              {p.incall_outcall}
            </span>
          )}
          {p.independent_or_agency && (
            <span className="bg-pink-500/15 text-pink-400 text-xs font-bold px-3 py-1 rounded-full uppercase">
              {p.independent_or_agency}
            </span>
          )}
        </div>

        {/* Price */}
        {(p.price_text || p.price_min) && (
          <div className="mx-4 mb-3 bg-[#1a1a1a] border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Starting at</div>
            <div className="text-2xl font-bold text-pink-500">
              {p.price_min ? `${p.price_min} \u20AA` : ''}
            </div>
            {p.price_text && (
              <div className="text-sm text-zinc-400 mt-2 whitespace-pre-line">{p.price_text}</div>
            )}
          </div>
        )}

        {/* Services */}
        {p.services && p.services.length > 0 && (
          <div className="mx-4 mb-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Services</div>
            <div className="flex flex-wrap gap-2">
              {p.services.map((s, i) => (
                <span key={i} className="bg-zinc-800 text-zinc-300 text-xs px-3 py-1 rounded-full">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Availability */}
        {p.availability && (
          <div className="mx-4 mb-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Availability</div>
            <div className="text-sm text-zinc-300">{p.availability}</div>
          </div>
        )}

        {/* Description */}
        {p.description && (
          <div className="mx-4 mb-3">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">About</div>
            <div className="text-sm text-zinc-300 whitespace-pre-line">{p.description}</div>
          </div>
        )}

        {/* Contact Button */}
        <div className="px-4 py-6">
          <button className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-3.5 rounded-xl text-base tracking-wide transition-colors flex items-center justify-center gap-2">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
            CONTACT
          </button>
        </div>

        {/* Footer */}
        <div className="text-center pb-8">
          <span className="text-zinc-600 text-xs">tahles.top</span>
        </div>
      </div>
    </div>
  )
}
