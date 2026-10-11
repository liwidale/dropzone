use crate::dupes::Progress;
use crate::model::{Entry, Failure, Kind, Outcome};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const MAX_BYTES: u64 = 40_000_000;
const MAX_IMAGES: usize = 5000;
const THRESHOLD: u32 = 6;
const COLOR_THRESHOLD: u32 = 12;
const DECODABLE: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"];

type Key = (String, u64, i64);

#[derive(Clone, Copy)]
pub struct Print {
    hash: u64,
    pixels: u64,
    colors: [u8; 48],
}

pub type Cache = Mutex<HashMap<Key, Option<Print>>>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarGroup {
    pub id: String,
    pub files: Vec<Entry>,
    pub keep: String,
}

fn fingerprint(path: &Path) -> Option<Print> {
    let img = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let pixels = img.width() as u64 * img.height() as u64;
    let tiny = img
        .resize_exact(4, 4, image::imageops::FilterType::Triangle)
        .to_rgb8();
    let mut colors = [0u8; 48];
    for (i, p) in tiny.pixels().enumerate() {
        colors[i * 3..i * 3 + 3].copy_from_slice(&p.0);
    }
    let small = img
        .resize_exact(9, 8, image::imageops::FilterType::Triangle)
        .to_luma8();
    let mut hash = 0u64;
    for y in 0..8 {
        for x in 0..8 {
            hash <<= 1;
            if small.get_pixel(x, y)[0] > small.get_pixel(x + 1, y)[0] {
                hash |= 1;
            }
        }
    }
    Some(Print {
        hash,
        pixels,
        colors,
    })
}

fn alike(a: &Print, b: &Print) -> bool {
    if (a.hash ^ b.hash).count_ones() > THRESHOLD {
        return false;
    }
    let diff: u32 = a
        .colors
        .iter()
        .zip(b.colors.iter())
        .map(|(x, y)| x.abs_diff(*y) as u32)
        .sum();
    diff <= COLOR_THRESHOLD * a.colors.len() as u32
}

fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

pub fn find(
    entries: &[Entry],
    cache: &Cache,
    cancel: &AtomicBool,
    progress: impl Fn(Progress),
) -> Outcome<Vec<SimilarGroup>> {
    let mut candidates: Vec<&Entry> = entries
        .iter()
        .filter(|e| {
            matches!(e.kind, Kind::Image | Kind::Screenshot)
                && DECODABLE.contains(&e.ext.as_str())
                && e.size <= MAX_BYTES
                && e.project.is_none()
        })
        .collect();
    candidates.sort_by_key(|e| std::cmp::Reverse(e.added));
    candidates.truncate(MAX_IMAGES);
    let total = candidates.len() as u64;
    let mut prints: Vec<(&Entry, Print)> = Vec::new();
    for (i, e) in candidates.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::new("cancelled", ""));
        }
        let key = (e.path.clone(), e.size, e.modified);
        let cached = cache.lock().ok().and_then(|c| c.get(&key).copied());
        let print = match cached {
            Some(p) => p,
            None => {
                let p = fingerprint(Path::new(&e.path));
                if let Ok(mut c) = cache.lock() {
                    c.insert(key, p);
                }
                p
            }
        };
        if let Some(p) = print {
            prints.push((e, p));
        }
        progress(Progress {
            done: i as u64 + 1,
            total,
        });
    }

    let n = prints.len();
    let mut parent: Vec<usize> = (0..n).collect();
    for i in 0..n {
        for j in i + 1..n {
            if alike(&prints[i].1, &prints[j].1) {
                let (a, b) = (root(&mut parent, i), root(&mut parent, j));
                if a != b {
                    parent[b] = a;
                }
            }
        }
    }
    let mut buckets: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = root(&mut parent, i);
        buckets.entry(r).or_default().push(i);
    }
    let mut groups: Vec<SimilarGroup> = buckets
        .into_values()
        .filter(|members| members.len() > 1)
        .filter(|members| {
            members
                .iter()
                .any(|&i| prints[i].0.size != prints[members[0]].0.size)
        })
        .map(|mut members| {
            members.sort_by_key(|&i| {
                (
                    std::cmp::Reverse(prints[i].1.pixels),
                    std::cmp::Reverse(prints[i].0.added),
                )
            });
            let files: Vec<Entry> = members.iter().map(|&i| prints[i].0.clone()).collect();
            SimilarGroup {
                id: format!("{:016x}", prints[members[0]].1.hash),
                keep: files[0].path.clone(),
                files,
            }
        })
        .collect();
    groups.sort_by_key(|g| std::cmp::Reverse(g.files.iter().skip(1).map(|f| f.size).sum::<u64>()));
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::{scan, Options};
    use crate::testutil::TempDir;
    use image::{Rgb, RgbImage};

    fn gradient(w: u32, h: u32, shift: u8, flip: bool) -> RgbImage {
        RgbImage::from_fn(w, h, |x, y| {
            let v = ((x * 255 / w) as u8).saturating_add(shift);
            let v = if flip { 255 - v } else { v };
            Rgb([v, (y * 255 / h) as u8, 128])
        })
    }

    #[test]
    fn groups_similar_images() {
        let t = TempDir::new("similar");
        gradient(400, 300, 0, false)
            .save(t.path().join("shot.png"))
            .unwrap();
        gradient(200, 150, 4, false)
            .save(t.path().join("shot small.png"))
            .unwrap();
        gradient(400, 300, 0, true)
            .save(t.path().join("other.png"))
            .unwrap();
        RgbImage::from_fn(400, 300, |x, y| {
            Rgb([(x * 255 / 400) as u8, (y * 255 / 300) as u8, 20])
        })
        .save(t.path().join("same shape other color.png"))
        .unwrap();
        let snap = scan(
            t.path(),
            Options {
                hidden: false,
                recursive: true,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        let groups = find(
            &snap.entries,
            &Cache::default(),
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert!(groups[0].keep.ends_with("shot.png"));
    }
}
