import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
    global: {
      fetch: (url, options = {}) =>
        fetch(url, { ...options, cache: 'no-store' }),  // ← new
    },
  }
  )

  const { searchParams } = new URL(request.url)
  const annotated = searchParams.get('annotated') === 'true'
  const skipIds   = searchParams.get('skip')?.split(',').filter(Boolean) || []

  if (annotated) {
    const { data, error } = await supabase
      .from('images')
      .select('id, filename, cloudinary_url, heckmatt_grade')
      .eq('is_annotated', true)
      .order('created_at', { ascending: false })

    if (error) return Response.json({ error: error.message }, { status: 500 })

    const images = (data || []).map(img => ({
      id:       img.id,
      filename: img.filename,
      grade:    img.heckmatt_grade,
      url:      img.cloudinary_url,
    }))

    return Response.json({ images })
  }

  let query = supabase
    .from('images')
    .select('id, filename, cloudinary_url, heckmatt_grade, is_annotated')
    .eq('is_annotated', false)
    .order('created_at', { ascending: true })
    .limit(1)

  if (skipIds.length > 0) {
    query = query.not('id', 'in', `(${skipIds.join(',')})`)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return Response.json({ done: true })

  const image = data[0]
  return Response.json({
    id:       image.id,
    filename: image.filename,
    grade:    image.heckmatt_grade,
    url:      image.cloudinary_url,
  })
}
