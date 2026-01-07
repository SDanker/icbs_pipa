import os

from flask import Flask, render_template, request, jsonify, send_from_directory
import pyodbc

app = Flask(__name__)
DATA_DIR = os.path.join(app.root_path, "data")

# =========================
# CONFIGURACIÓN BD
# =========================
DB_DRIVER = "ODBC Driver 17 for SQL Server"
DB_SERVER = "floppi.one"
DB_NAME = "iCBS"
DB_USER = "iCBS"
DB_PASSWORD = "Tobalaba455!"

ENCRYPT = "no"
TRUST_SERVER_CERT = "yes"
CONN_TIMEOUT = 30


def get_conn():
    conn_str = (
        f"DRIVER={{{DB_DRIVER}}};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"UID={DB_USER};"
        f"PWD={DB_PASSWORD};"
        f"Encrypt={ENCRYPT};"
        f"TrustServerCertificate={TRUST_SERVER_CERT};"
        f"Connection Timeout={CONN_TIMEOUT};"
    )
    return pyodbc.connect(conn_str)


def parse_ids(csv: str, max_ids: int = 200):
    if not csv:
        return []
    out = []
    for part in csv.split(","):
        part = part.strip()
        try:
            out.append(int(part))
        except ValueError:
            pass
        if len(out) >= max_ids:
            break
    return out


# =========================
# COLORES DE ESTADO
# =========================
def obtener_color(in_service, available, failure):
    if in_service == 1 and available == 1:
        return "green"      # 🟢
    if in_service == 1 and available == 0:
        return "blue"     # 🔵
    if in_service == 0 and failure == 1:
        return "red"        # 🔴
    if in_service == 0 and available == 1:
        return "yellow"       # 🟡
    if in_service == 0 and available == 0:
        return "red"        # 🔴
    return "gray"


# =========================
# PÁGINAS
# =========================
@app.route("/")
def service():
    return render_template("service.html")

@app.route("/gps")
def gps():
    return render_template("index.html")

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")

@app.route("/otros-cuerpos")
def otros_cuerpos():
    return render_template("dashboard_otros.html")

@app.route("/dashboard/resumen")
def resumen():
    return render_template("resumen-estados.html")

@app.route("/dashboard/cuartel")
def cuartel():
    return render_template("carro_cuartel.html")

# =========================
# DATA (CSV Cuarteles)
# =========================
@app.route("/data/<path:filename>")
def data_files(filename):
    return send_from_directory(DATA_DIR, filename)


# =========================
# APIs GPS (tabla gps)
# =========================
@app.route("/api/vehicles")
def vehicles():
    sql = """
    WITH x AS (
      SELECT vehiculo_id, name,
             ROW_NUMBER() OVER (PARTITION BY vehiculo_id ORDER BY [timestamp] DESC) rn
      FROM gps
    )
    SELECT vehiculo_id, name
    FROM x WHERE rn = 1
    ORDER BY vehiculo_id
    """
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql)
        rows = cur.fetchall()

    return jsonify([
        {"vehiculo_id": int(r.vehiculo_id), "name": r.name}
        for r in rows
    ])


@app.route("/api/latest")
def latest():
    ids = parse_ids(request.args.get("vehiculo_ids", ""), 500)

    where = ""
    params = []
    if ids:
        where = "WHERE vehiculo_id IN (" + ",".join("?" * len(ids)) + ")"
        params = ids

    sql = f"""
    WITH x AS (
      SELECT id, vehiculo_id, name, lat, lon, [timestamp],
             ROW_NUMBER() OVER (PARTITION BY vehiculo_id ORDER BY [timestamp] DESC) rn
      FROM gps {where}
    )
    SELECT * FROM x WHERE rn = 1
    ORDER BY vehiculo_id
    """

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()

    return jsonify([{
        "id": int(r.id),
        "vehiculo_id": int(r.vehiculo_id),
        "name": r.name,
        "lat": float(r.lat),
        "lon": float(r.lon),
        "timestamp": r.timestamp.isoformat(sep=" ")
    } for r in rows])


@app.route("/api/track")
def track():
    vehiculo_id = request.args.get("vehiculo_id")
    limit = min(int(request.args.get("limit", 100)), 100)

    sql = """
    SELECT TOP (?) id, vehiculo_id, name, lat, lon, [timestamp]
    FROM gps
    WHERE vehiculo_id = ?
    ORDER BY [timestamp] DESC
    """

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (limit, vehiculo_id))
        rows = cur.fetchall()

    rows.reverse()

    return jsonify([{
        "id": int(r.id),
        "vehiculo_id": int(r.vehiculo_id),
        "name": r.name,
        "lat": float(r.lat),
        "lon": float(r.lon),
        "timestamp": r.timestamp.isoformat(sep=" ")
    } for r in rows])


# =========================
# API ESTADOS (tabla Carro)
# =========================
@app.route("/api/carros")
def api_carros():
    try:
        sql = """
        SELECT
            Id,
            id_icbs,
            name,
            lon,
            lat,
            in_service,
            failure,
            available,
            Conductor
        FROM dbo.Carro
        ORDER BY name
        """

        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(sql)
            rows = cur.fetchall()

        data = []
        for r in rows:
            data.append({
                "id": int(r.Id),
                "id_icbs": r.id_icbs,
                "nombre": r.name,
                "color": obtener_color(r.in_service, r.available, r.failure),
                "lat": float(r.lat) if r.lat is not None else None,
                "lng": float(r.lon) if r.lon is not None else None,
                "conductor": r.Conductor
            })

        return jsonify(data)

    except Exception as e:
        print("❌ ERROR /api/carros:", e)
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081, debug=True)
