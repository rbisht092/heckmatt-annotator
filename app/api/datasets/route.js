import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

async function destroyCloudinary(publicId) {
  if (!publicId) return { result: 'missing' }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = crypto
    .createHash('sha256')
    .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex')

  const formData = new FormData()
  formData.append('public_id', publicId)
  formData.append('timestamp', timestamp)
  formData.append('api_key', apiKey)
  formData.append('signature', signature)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Cloudinary delete failed')
  }

  return res.json()
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
  )

  const { data: images, error: imagesError } = await supabase
    .from('images')
    .select('id, dataset, is_annotated')
    .range(0, 99999)

  if (imagesError) return Response.json({ error: imagesError.message }, { status: 500 })

  const { data: annotations, error: annotationsError } = await supabase
    .from('annotations')
    .select('image_id, images!inner(dataset)')
    .range(0, 99999)

  if (annotationsError) return Response.json({ error: annotationsError.message }, { status: 500 })

  const byDataset = new Map()
  for (const img of images || []) {
    const name = img.dataset || 'unknown'
    if (!byDataset.has(name)) {
      byDataset.set(name, { name, total: 0, flaggedAnnotated: 0, boxed: 0 })
    }
    const entry = byDataset.get(name)
    entry.total += 1
    if (img.is_annotated) entry.flaggedAnnotated += 1
  }

  const boxedByDataset = new Map()
  for (const row of annotations || []) {
    const name = row.images?.dataset || 'unknown'
    if (!boxedByDataset.has(name)) boxedByDataset.set(name, new Set())
    boxedByDataset.get(name).add(row.image_id)
  }

  for (const [name, ids] of boxedByDataset) {
    if (!byDataset.has(name)) {
      byDataset.set(name, { name, total: 0, flaggedAnnotated: 0, boxed: 0 })
    }
    byDataset.get(name).boxed = ids.size
  }

  const datasets = Array.from(byDataset.values())
    .sort((a, b) => a.name.localeCompare(b.name))

  return Response.json({ datasets })
}

export async function DELETE(request) {
  const adminPasscode = process.env.ADMIN_PASSCODE || 'heckmattadmin2024'
  if (request.headers.get('x-admin-passcode') !== adminPasscode) {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
  )

  const { searchParams } = new URL(request.url)
  const dataset = searchParams.get('dataset')
  if (!dataset) return Response.json({ error: 'Missing dataset' }, { status: 400 })

  const { data: images, error: imageError } = await supabase
    .from('images')
    .select('id, cloudinary_id')
    .eq('dataset', dataset)
    .range(0, 99999)

  if (imageError) return Response.json({ error: imageError.message }, { status: 500 })
  if (!images || images.length === 0) return Response.json({ deleted: 0, cloudinaryDeleted: 0 })

  let cloudinaryDeleted = 0
  const cloudinaryErrors = []
  for (const img of images) {
    try {
      const result = await destroyCloudinary(img.cloudinary_id)
      if (result.result === 'ok' || result.result === 'not found' || result.result === 'missing') {
        cloudinaryDeleted += 1
      }
    } catch (err) {
      cloudinaryErrors.push({ id: img.id, error: err.message })
    }
  }

  const ids = images.map(img => img.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { error: annotationError } = await supabase
      .from('annotations')
      .delete()
      .in('image_id', ids.slice(i, i + 200))

    if (annotationError) return Response.json({ error: annotationError.message }, { status: 500 })
  }

  const { error: deleteError } = await supabase
    .from('images')
    .delete()
    .eq('dataset', dataset)

  if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 })

  return Response.json({
    deleted: images.length,
    cloudinaryDeleted,
    cloudinaryErrors,
  })
}
