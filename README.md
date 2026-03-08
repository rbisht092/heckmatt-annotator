# Heckmatt Annotator

USG muscle annotation tool — doctors draw bounding boxes, Heckmatt grade is auto-attached from DB.
Exports YOLO-format `.txt` labels named after each image, ready for training.

---

## Stack
- **Next.js 14** — frontend + API routes
- **Supabase** — Postgres DB (image metadata + annotations)
- **Cloudinary** — image hosting & CDN (25GB free)
- **Vercel** — hosting

---

## Full Setup (4 steps)

### 1. Create accounts (all free)
| Service | URL | What you need |
|---------|-----|--------------|
| Supabase | supabase.com | Project URL + anon key + service_role key |
| Cloudinary | cloudinary.com | Cloud name + API key + API secret |
| Vercel | vercel.com | Connect GitHub repo |

---

### 2. Set up Supabase DB
In Supabase → SQL Editor → paste and run `supabase_schema.sql`

Creates two tables:
- `images` — filename, cloudinary_url, heckmatt_grade, is_annotated
- `annotations` — bounding box coords + yolo_txt per image

---

### 3. Upload your images

Prepare a `grades.csv`:
```
filename,heckmatt_grade
patient01_Bmode.tif,2
patient02_Bmode.tif,3
```

Fill in `upload_images.py` with your credentials, then:
```bash
pip install cloudinary supabase pandas
python upload_images.py
```

Each `.tif` uploads to Cloudinary (auto-converts to `.jpg` for browser display),
CDN URL + grade get saved into Supabase.

---

### 4. Deploy to Vercel

```bash
vercel
```

Add these env vars in Vercel → Project → Settings → Environment Variables:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

---

## Annotator workflow

1. Loads next unannotated image automatically
2. Doctor draws bounding box by clicking + dragging
3. Grade badge shown automatically from DB (no manual input)
4. **Save** → stores annotation, loads next image
5. **Skip** → queues image to come back later
6. **Export YOLO** → downloads `labels.zip`

---

## Export format

```
labels/
  patient01_Bmode.txt     ← "2 0.523142 0.341200 0.120000 0.089500"
  patient02_Bmode.txt
```

One line per file: `class_id x_center y_center width height` (all normalized 0–1).
`class_id = heckmatt_grade - 1` so grade 1→0, 2→1, 3→2, 4→3.

Drop `labels/` next to your `images/` folder → ready for YOLO training.

---

## Local dev
```bash
cp .env.local.example .env.local
npm install
npm run dev
```
