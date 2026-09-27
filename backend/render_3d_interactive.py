"""
render_3d_interactive.py — makes a rotatable, zoomable 3D view as an HTML
file (opens in any browser, drag with mouse to spin it around). Good for
testing/demo before Person C wires up the real Three.js viewer in the
dashboard.

Usage: python render_3d_interactive.py <heightmap.npy> <texture_crop.png> <output.html>
"""
import sys
import numpy as np
from PIL import Image
import plotly.graph_objects as go


def render_interactive(heightmap_npy_path, texture_patch_path, out_html_path):
    heightmap = np.load(heightmap_npy_path)

    texture = Image.open(texture_patch_path).convert("L").resize(
        (heightmap.shape[1], heightmap.shape[0])
    )
    texture_arr = np.asarray(texture, dtype=np.float32)

    fig = go.Figure(data=[go.Surface(
        z=heightmap,
        surfacecolor=texture_arr,   # drape the original sonar texture as color
        colorscale="ylorbr",
        showscale=False,
        lighting=dict(ambient=0.5, diffuse=0.8, specular=0.3, roughness=0.6),
        lightposition=dict(x=100, y=200, z=300),
    )])

    fig.update_layout(
        scene=dict(
            xaxis_visible=False, yaxis_visible=False, zaxis_visible=False,
            aspectmode="data",
        ),
        margin=dict(l=0, r=0, t=0, b=0),
    )
    fig.write_html(out_html_path)
    print(f"Saved interactive view to {out_html_path} — open it in any browser")


if __name__ == "__main__":
    render_interactive(sys.argv[1], sys.argv[2], sys.argv[3])