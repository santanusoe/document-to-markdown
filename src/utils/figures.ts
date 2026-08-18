export interface NormalizedRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function imageRegionsFromCoordinates(coordinates: ArrayLike<number> | null | undefined): NormalizedRegion[] {
  if (!coordinates?.length) return [];
  const regions: NormalizedRegion[] = [];
  for (let index = 0; index + 5 < coordinates.length; index += 6) {
    const xs = [Number(coordinates[index]), Number(coordinates[index + 2]), Number(coordinates[index + 4])];
    const ys = [Number(coordinates[index + 1]), Number(coordinates[index + 3]), Number(coordinates[index + 5])];
    if ([...xs, ...ys].some((value) => !Number.isFinite(value))) continue;
    const region = {
      left: clampUnit(Math.min(...xs)),
      top: clampUnit(Math.min(...ys)),
      right: clampUnit(Math.max(...xs)),
      bottom: clampUnit(Math.max(...ys)),
    };
    if (region.right - region.left > 0.001 && region.bottom - region.top > 0.001) regions.push(region);
  }
  return regions.filter((region, index) => !regions.slice(0, index).some((other) => {
    const intersectionWidth = Math.max(0, Math.min(region.right, other.right) - Math.max(region.left, other.left));
    const intersectionHeight = Math.max(0, Math.min(region.bottom, other.bottom) - Math.max(region.top, other.top));
    const intersection = intersectionWidth * intersectionHeight;
    const regionArea = (region.right - region.left) * (region.bottom - region.top);
    const otherArea = (other.right - other.left) * (other.bottom - other.top);
    return intersection / Math.max(0.0001, Math.min(regionArea, otherArea)) > 0.88;
  }));
}
