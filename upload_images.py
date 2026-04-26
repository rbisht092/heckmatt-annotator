"""
Upload local USG images to Cloudinary + register in Supabase DB.
Grade is inferred from folder structure — no CSV needed.

Expected folder layout:
    IMAGE_ROOT/
        grade1/   ← heckmatt grade 1
            patient01_Bmode.tif
        grade2/
            patient03_Bmode.tif
        grade3/
            ...
        grade4/
            ...
        unlabeled/   ← NEW: images with no grade yet — grade will be assigned in the app
            patient99_Bmode.tif

Folder names must contain the grade digit (1–4), OR be named "unlabeled" (case-insensitive).
Examples that work: "grade1", "Grade1", "heckmatt_1", "1", "unlabeled", "Unlabeled"

Requirements:
    pip install cloudinary supabase

Usage:
    1. Fill in the CONFIG section below
    2. Run: python upload_images.py
"""

import os
import re
import glob
import cloudinary
import cloudinary.uploader
from supabase import create_client

# ── CONFIG ────────────────────────────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME = "your-cloud-name"
CLOUDINARY_API_KEY    = "your-api-key"
CLOUDINARY_API_SECRET = "your-api-secret"

SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_KEY = "your-service-role-key"   # Settings → API → service_role key

# Root folder that contains your grade1/ grade2/ ... grade4/ and/or unlabeled/ subfolders
IMAGE_ROOT = "/path/to/your/data"
# ──────────────────────────────────────────────────────────────────────────────

cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET,
    secure=True,
)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def grade_from_folder(folder_name):
    """Extract grade digit from folder name. 'grade2' → 2, 'Grade3' → 3, '1' → 1
    Returns None if unlabeled, -1 if unrecognised."""
    if folder_name.lower() in ("unlabeled", "unlabelled"):
        return None          # None = no grade assigned yet
    match = re.search(r'[1-4]', folder_name)
    return int(match.group()) if match else -1  # -1 = skip

# Walk each subfolder
grade_folders = [
    f for f in os.listdir(IMAGE_ROOT)
    if os.path.isdir(os.path.join(IMAGE_ROOT, f))
]

print(f"Found folders: {grade_folders}\n")

success, skipped, failed = 0, 0, 0

for folder_name in sorted(grade_folders):
    grade = grade_from_folder(folder_name)

    if grade == -1:
        print(f"[SKIP] '{folder_name}' — no grade digit (1-4) found and not 'unlabeled'\n")
        continue

    is_unlabeled = grade is None
    folder_path  = os.path.join(IMAGE_ROOT, folder_name)
    image_files  = (
        glob.glob(os.path.join(folder_path, "*.bmp"))  +
        glob.glob(os.path.join(folder_path, "*.tif"))  +
        glob.glob(os.path.join(folder_path, "*.tiff")) +
        glob.glob(os.path.join(folder_path, "*.png"))  +
        glob.glob(os.path.join(folder_path, "*.jpg"))
    )

    label = "unlabeled" if is_unlabeled else f"Grade {grade}"
    print(f"{label} ({folder_name}) — {len(image_files)} images")

    for img_path in image_files:
        filename  = os.path.basename(img_path)
        public_id = filename.rsplit('.', 1)[0].replace('.', '_')

        cloudinary_folder = "heckmatt/unlabeled" if is_unlabeled else f"heckmatt/grade{grade}"

        try:
            # 1. Upload to Cloudinary
            result = cloudinary.uploader.upload(
                img_path,
                public_id=f"{cloudinary_folder}/{public_id}",
                resource_type="image",
                overwrite=True,
                format="jpg",
            )

            cdn_url    = result["secure_url"]
            public_cid = result["public_id"]

            # 2. Register in Supabase
            # heckmatt_grade is NULL for unlabeled images — the annotator will fill it in
            row = {
                'filename':       filename,
                'cloudinary_url': cdn_url,
                'cloudinary_id':  public_cid,
                'is_annotated':   False,
            }
            if not is_unlabeled:
                row['heckmatt_grade'] = grade

            supabase.table('images').insert(row).execute()

            print(f"  [OK] {filename}")
            success += 1

        except Exception as e:
            print(f"  [ERR] {filename}: {e}")
            failed += 1

    print()

print("─" * 50)
print(f"Done: {success} uploaded, {failed} failed")
