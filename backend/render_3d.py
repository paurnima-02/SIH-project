"""
render_3d.py — renders 3D/2D previews of a reconstructed heightmap.

render_textured_surface: shaded 3-D perspective mesh (styled amber/bronze,
    like classic sonar imagery).
render_elevation_map: proper top-down elevation map with a colorbar and
    real-world axes in metres — this is what Fig. 6(c)/9(c) in Coiras et
    al. actually are, a labeled 2-D height image, not a 3-D mesh.
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
from PIL import Image


def render_elevation_map(
    heightmap_npy_path: str,
    pixel_size_m: float,
    out_path: str,
    cmap: str = "gray",
) -> None:
    """
    Renders a proper top-down elevation map with a colorbar and real-world
    axes in metres — this is what Fig. 6(c)/9(c) in Coiras et al. actually
    are: a labeled 2-D height image, not a 3-D perspective mesh. Much
    simpler and inherently readable regardless of how rough the raw data
    is, since there's no mesh/lighting/viewing-angle to get wrong.
    """
    heightmap = np.load(heightmap_npy_path)
    rows, cols = heightmap.shape
    extent = [0, cols * pixel_size_m, rows * pixel_size_m, 0]

    fig, ax = plt.subplots(figsize=(7, 5))
    im = ax.imshow(heightmap, cmap=cmap, extent=extent, aspect="auto")
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("Height (m)")
    ax.set_xlabel("Range (m)")
    ax.set_ylabel("Along-track (m)")
    ax.set_title("Elevation map")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close(fig)


def render_textured_surface(
    heightmap_npy_path: str,
    texture_patch_path: str,
    out_path: str,
    pixel_size_m: float = 0.1,
    vert_exaggeration: float = 5.0,
    azdeg: float = 315,
    altdeg: float = 55,
    colormap: str = "copper",
):
    """
    vert_exaggeration is now an EXPLICIT, controlled multiplier on real
    height — not an accidental one. Previously X/Y were plotted in raw
    pixel counts (hundreds) while Z was in real metres, with no shared
    scale between them; matplotlib then stretched a genuinely small real
    height (e.g. 0.5 m across a 30 m wide scene) to fill much of the
    plot, which is what made every reconstruction look like dramatic
    mountains regardless of how gentle the actual data was. Putting X, Y,
    Z all in metres and setting the box aspect to the TRUE physical
    proportions means a gentle platform now actually renders as gentle —
    vert_exaggeration is the one deliberate knob left for making subtle
    relief visible, exactly the way the paper's own figures use it.
    """
    heightmap = np.load(heightmap_npy_path)  # in metres

    texture = Image.open(texture_patch_path).convert("L").resize(
        (heightmap.shape[1], heightmap.shape[0])
    )
    texture_arr = np.asarray(texture, dtype=np.float32) / 255.0

    cmap = plt.get_cmap(colormap)
    texture_rgb = cmap(texture_arr)[:, :, :3]

    rows, cols = heightmap.shape
    X, Y = np.meshgrid(np.arange(cols) * pixel_size_m, np.arange(rows) * pixel_size_m)
    Z = heightmap * vert_exaggeration  # explicit, labeled exaggeration only

    ls = LightSource(azdeg=azdeg, altdeg=altdeg)
    shaded_rgb = ls.shade_rgb(texture_rgb, heightmap, vert_exag=1.0, blend_mode="soft")

    fig = plt.figure(figsize=(9, 7))
    ax = fig.add_subplot(111, projection="3d")
    ax.plot_surface(
        X, Y, Z,
        rstride=1, cstride=1,
        facecolors=shaded_rgb,
        linewidth=0, antialiased=True, shade=False,
    )

    real_width = cols * pixel_size_m
    real_height = rows * pixel_size_m
    z_extent = max(float(Z.max() - Z.min()), 1e-6)
    ax.set_box_aspect((real_width, real_height, z_extent))  # TRUE physical proportions
    ax.set_axis_off()
    ax.view_init(elev=35, azim=-60)

    plt.savefig(out_path, dpi=140, bbox_inches="tight", facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    import sys
    render_textured_surface(sys.argv[1], sys.argv[2], sys.argv[3])