"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const SPOOL_COLORS = ["#D9A15B", "#4FB2A3", "#7FA8DB", "#C98CA7", "#9FBF6A", "#B99CE0"];
const C_FIELD = "#FF6B4A";
const C_SHOP = "#CFDDE6";
const V = (p) => new THREE.Vector3(p.x, p.y, p.z);

export default function Viewer3D({ model, selected, onSelect, exploded, showTags, showDims, view }) {
  const mountRef = useRef(null);
  const layerRef = useRef(null);
  const api = useRef({});
  const flags = useRef({});
  flags.current = { selected, exploded, showTags, showDims };

  useEffect(() => {
    if (!model || model.error) return;
    const mount = mountRef.current;
    const layer = layerRef.current;
    layer.innerHTML = "";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 5, 500000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xa8c4d4, 0x0a1016, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-1, 1.6, 0.9).multiplyScalar(20000);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb0c4, 0.5);
    rim.position.set(1, 0.3, -1).multiplyScalar(20000);
    scene.add(rim);

    // bounds
    const box = new THREE.Box3();
    model.pts.forEach((p) => box.expandByPoint(V(p)));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1000);

    const grid = new THREE.GridHelper(span * 3, 30, 0x1d3038, 0x121e25);
    grid.position.set(center.x, box.min.y - span * 0.12, center.z);
    scene.add(grid);

    const R = model.diameter / 2;
    const EXPLODE = span * 0.18;

    const groups = {};
    model.spoolIds.forEach((id, i) => {
      const g = new THREE.Group();
      g.userData.color = SPOOL_COLORS[i % SPOOL_COLORS.length];
      scene.add(g);
      groups[id] = g;
    });
    const grp = (id) => groups[id] || groups[model.spoolIds[0]];

    // explode offsets: push each spool along the route axis
    const dirOf = {};
    model.spoolIds.forEach((id, i) => {
      const mid = (model.spoolIds.length - 1) / 2;
      const axis = new THREE.Vector3().subVectors(V(model.pts[model.pts.length - 1]), V(model.pts[0])).normalize();
      dirOf[id] = axis.multiplyScalar((i - mid) * EXPLODE);
    });

    model.elements.forEach((e) => {
      const a = V(e.a), b = V(e.b);
      const curve = e.kind === "fitting"
        ? new THREE.QuadraticBezierCurve3(a, V(e.v), b)
        : new THREE.LineCurve3(a, b);
      if (a.distanceTo(b) < 1 && e.kind !== "fitting") return;
      const g = grp(e.spool);
      const base = new THREE.Color(g.userData.color);
      const mat = new THREE.MeshStandardMaterial({
        color: e.kind === "pup" ? base.clone().offsetHSL(0, -0.14, -0.14) : base,
        metalness: 0.45,
        roughness: e.kind === "fitting" ? 0.42 : 0.58,
      });
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, e.kind === "fitting" ? 48 : 2, R, 36, false), mat));
    });

    // weld rings
    const ringGeo = new THREE.CylinderGeometry(R * 1.12, R * 1.12, Math.max(40, R * 0.09), 36, 1, true);
    const rings = [];
    model.register.forEach((w, i) => {
      const isField = w.loc === "Field";
      const m = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
        color: isField ? C_FIELD : C_SHOP,
        emissive: isField ? C_FIELD : "#3d4d59",
        emissiveIntensity: isField ? 0.55 : 0.18,
        metalness: 0.2, roughness: 0.35,
      }));
      m.position.copy(V(w.at));
      const prev = model.register[i - 1], next = model.register[i + 1];
      const ref = next ? V(next.at) : prev ? V(prev.at) : new THREE.Vector3(0, 1, 0);
      const axis = new THREE.Vector3().subVectors(ref, V(w.at)).normalize();
      if (axis.lengthSq() > 0.5) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      m.userData.weld = w.no;
      grp(w.spool).add(m);
      rings.push(m);
    });

    // labels
    const labels = [];
    const mk = (cls, text, pos, spool, tag) => {
      const el = document.createElement("div");
      el.className = cls; el.textContent = text;
      layer.appendChild(el);
      labels.push({ el, pos: V(pos), spool, tag, dim: cls === "wm-dim" });
    };
    model.register.forEach((w) => mk("wm-tag", w.no, w.at, w.spool, w.no));
    model.elements.filter((e) => e.kind === "pipe" && e.length > 300).forEach((e) => {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, z: (e.a.z + e.b.z) / 2 };
      mk("wm-dim", Math.round(e.length).toLocaleString("en-US"), mid, e.spool, null);
    });

    // orbit
    const target = center.clone();
    const sph = { theta: 0.95, phi: 1.12, radius: span * 1.9 };
    const goal = { ...sph };
    api.current = { goal, camera };

    let dragging = false, moved = 0, px = 0, py = 0, pinch = 0;
    const dom = renderer.domElement;
    const down = (e) => { dragging = true; moved = 0; px = e.clientX; py = e.clientY; };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      moved += Math.abs(dx) + Math.abs(dy);
      goal.theta -= dx * 0.006;
      goal.phi = Math.max(0.08, Math.min(Math.PI - 0.08, goal.phi - dy * 0.006));
      px = e.clientX; py = e.clientY;
    };
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const up = (e) => {
      if (dragging && moved < 6) {
        const r = dom.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(rings, false)[0];
        onSelect(hit ? hit.object.userData.weld : null);
      }
      dragging = false;
    };
    const wheel = (e) => {
      e.preventDefault();
      goal.radius = Math.max(span * 0.15, Math.min(span * 8, goal.radius * (1 + e.deltaY * 0.0012)));
    };
    const tmove = (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinch) goal.radius = Math.max(span * 0.15, Math.min(span * 8, goal.radius * (pinch / d)));
        pinch = d; dragging = false;
      }
    };
    const tend = () => { pinch = 0; };

    dom.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    dom.addEventListener("wheel", wheel, { passive: false });
    dom.addEventListener("touchmove", tmove, { passive: true });
    dom.addEventListener("touchend", tend);

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(mount);

    const proj = new THREE.Vector3();
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = flags.current;
      sph.theta += (goal.theta - sph.theta) * 0.12;
      sph.phi += (goal.phi - sph.phi) * 0.12;
      sph.radius += (goal.radius - sph.radius) * 0.1;
      camera.position.set(
        target.x + sph.radius * Math.sin(sph.phi) * Math.sin(sph.theta),
        target.y + sph.radius * Math.cos(sph.phi),
        target.z + sph.radius * Math.sin(sph.phi) * Math.cos(sph.theta)
      );
      camera.lookAt(target);

      model.spoolIds.forEach((id) => {
        const g = groups[id];
        g.position.lerp(f.exploded ? dirOf[id] : new THREE.Vector3(), 0.14);
      });
      rings.forEach((m) => {
        const on = f.selected === m.userData.weld;
        m.scale.lerp(new THREE.Vector3(on ? 1.5 : 1, on ? 2.6 : 1, on ? 1.5 : 1), 0.2);
      });

      const rect = dom.getBoundingClientRect();
      labels.forEach((L) => {
        if ((L.dim && !f.showDims) || (!L.dim && !f.showTags)) { L.el.style.opacity = "0"; return; }
        proj.copy(L.pos).add(groups[L.spool] ? groups[L.spool].position : new THREE.Vector3()).project(camera);
        const x = (proj.x * 0.5 + 0.5) * rect.width;
        const y = (-proj.y * 0.5 + 0.5) * rect.height;
        L.el.style.opacity = proj.z < 1 ? "0.92" : "0";
        L.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
        if (L.tag) {
          const w = model.register.find((q) => q.no === L.tag);
          const on = L.tag === f.selected;
          L.el.style.borderColor = on ? "#fff" : w.loc === "Field" ? C_FIELD : "#43555f";
          L.el.style.color = on ? "#0A0E12" : w.loc === "Field" ? C_FIELD : "#DDE7EE";
          L.el.style.background = on ? "#fff" : "rgba(9,13,17,.82)";
        }
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      dom.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dom.removeEventListener("wheel", wheel);
      dom.removeEventListener("touchmove", tmove);
      dom.removeEventListener("touchend", tend);
      layer.innerHTML = "";
      renderer.dispose();
      if (dom.parentNode) dom.parentNode.removeChild(dom);
    };
  }, [model]);

  useEffect(() => {
    const g = api.current.goal; if (!g) return;
    if (view === "iso") { g.theta = 0.95; g.phi = 1.12; }
    if (view === "elev") { g.theta = 1.5708; g.phi = 1.5708; }
    if (view === "plan") { g.theta = 0.0001; g.phi = 0.09; }
  }, [view]);

  return (
    <div ref={mountRef} className="viewer">
      <div ref={layerRef} className="labels" />
    </div>
  );
}

export { SPOOL_COLORS };
