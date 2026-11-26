# EduShelf Inventory Management System

A full-stack inventory management system for EduShelf. The original static
`localStorage` prototype is now backed by a Flask REST API and a normalized
MySQL/MariaDB database, with session authentication, role-based access control,
supply requests, stock transactions, and an append-only audit trail.

## Features

- **Authentication** — server-side sessions, Werkzeug password hashing, three-attempt
  account lockout, and a `/api/auth/me` session probe on every protected page.
- **Role-based access** — public registration creates `Warehouse Staff` accounts only;
  `Administrator` accounts are provisioned explicitly.
- **Inventory** — searchable and filterable catalog, add/edit forms, item details with
  per-item history, and admin-only deletion.
- **Supply requests** — staff submit requests; administrators approve or reject them.
  Approval re-checks stock inside a transaction and decrements quantity atomically.
- **Audit log** — searchable/filterable trail for logins, registrations, lockouts,
  create/edit/delete actions, requests, reviews, and opening stock.
- **Safety** — parameterized SQL everywhere, transactional writes with row locks for
  stock mutations, JSON validation, consistent error envelopes, and an allowlisted
  static file server that cannot expose `.env` or source files.

## Technology stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3, Flask, flask-cors, mysql-connector-python, python-dotenv, Werkzeug |
| Database | MySQL / MariaDB with InnoDB tables |
| Frontend | HTML5, ES6 JavaScript, Tailwind CSS (CDN), Lucide icons (CDN) |
| Data import | `openpyxl` for `.xlsx`, standard library `csv` for `.csv` |

## Project layout

```text
ims/
├── app.py                     # Flask API, auth, transactions, static host
├── auth_utils.py              # login_required / admin_required decorators
├── config.py                  # Environment-driven configuration
├── db.py                      # Connection and cursor context manager
├── seed_from_excel.py         # Idempotent datasheet importer
├── schema.sql                 # Tables + idempotent seed data
├── Dockerfile                 # Nginx + Gunicorn container
├── docker-compose.yml         # Single-container deployment
├── nginx.conf                 # Nginx reverse-proxy configuration
├── start-nginx.sh             # Database bootstrap + web server startup
├── requirements.txt
├── .env.example
├── app.js                     # Shared fetch/UI helper (EduShelf global)
├── js/                        # Page-specific ES6 scripts
├── index.html                 # Login
├── register.html              # Staff registration
├── dashboard.html
├── inventory.html
├── add-item.html
├── details.html
├── edit.html
├── requests.html
├── audit-log.html
├── styles.css                 # EduShelf brand styles
└── Datasheet for Inventory Management System - Datasheet.csv
```

## Demo accounts

| Role | Email | Password | Name |
| --- | --- | --- | --- |
| Administrator | `admin@edushelf.edu.ph` | `Admin@1234` | Juan Dela Cruz |
| Warehouse Staff | `staff@edushelf.edu.ph` | `Staff@1234` | Maria Santos |

These credentials are shown on the login card for convenience. There is no role
selector: the account's stored role determines its permissions.

### Permissions

| Action | Warehouse Staff | Administrator |
| --- | :---: | :---: |
| View dashboard, inventory, details, requests, audit log | Yes | Yes |
| Add / edit inventory items | Yes | Yes |
| Submit supply requests | Yes | Yes |
| Delete inventory items | No | Yes |
| Approve / reject supply requests | No | Yes |
| Self-register | Yes | No |

Public registration always creates `Warehouse Staff`. Submitting `role:
"Administrator"` to `/api/auth/register` returns `403`.

### Additional administrator accounts

Administrator accounts cannot be created through the UI. Generate a password
hash, then insert the account directly:

```bash
python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('choose-a-strong-password'))"
```

```sql
USE edushelf_db;

INSERT INTO users (full_name, email, password_hash, role)
VALUES (
  'New Administrator',
  'new.admin@edushelf.edu.ph',
  'paste-generated-hash-here',
  'Administrator'
);
```

To unlock an account after three failed logins:

```sql
UPDATE users
SET failed_attempts = 0, is_locked = 0
WHERE email = 'user@edushelf.edu.ph';
```

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Login with inline error banner and demo credentials |
| `register.html` | Warehouse Staff self-registration |
| `dashboard.html` | KPIs: total items, stock value, low stock, out of stock, pending requests, categories |
| `inventory.html` | Search plus Category, Status, and Location filters |
| `add-item.html` | Create an inventory item |
| `details.html` | Item details and per-item audit history |
| `edit.html` | Edit an inventory item |
| `requests.html` | Submit requests; admin approve/reject controls |
| `audit-log.html` | Search and filter the activity trail |

All pages use external page-specific scripts in `js/` and the shared `app.js`
helper. There is no `localStorage`, no `var`, no inline event handlers, and no
`alert()` usage. Banners are rendered inline with `textContent` to avoid XSS;
`confirm()` is reserved for destructive actions.

## API

Responses use a consistent envelope:

```json
{ "status": "success", "data": { } }
```

```json
{ "status": "error", "message": "A human-readable explanation." }
```

All endpoints except registration and login require an authenticated session.
Dates and times are serialized as UTC ISO-8601 strings.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create a Warehouse Staff account |
| `POST` | `/api/auth/login` | Public | Start a session |
| `POST` | `/api/auth/logout` | Auth | Clear the session |
| `GET` | `/api/auth/me` | Auth | Return the current user |
| `GET` | `/api/items` | Auth | List all inventory items |
| `POST` | `/api/items` | Auth | Create an item |
| `GET` | `/api/items/<product_code>` | Auth | Get one item and its audit history |
| `PUT` | `/api/items/<product_code>` | Auth | Update an item |
| `DELETE` | `/api/items/<product_code>` | Admin | Delete an item |
| `GET` | `/api/requests` | Auth | List supply requests |
| `POST` | `/api/requests` | Auth | Submit a pending request |
| `PATCH` | `/api/requests/<request_id>` | Admin | Approve or reject a request |
| `GET` | `/api/logs?q=&action=` | Auth | Search/filter audit logs |

Example item payload:

```json
{
  "product_code": "BP-BLK-001",
  "product_name": "Ballpen (Black)",
  "category": "Writing Tool",
  "quantity": 150,
  "unit_price": 10.00,
  "location": "Shelf A1",
  "threshold": 15
}
```

Example request payload:

```json
{
  "product_code": "BP-RED-002",
  "quantity_requested": 5,
  "purpose": "Classroom supplies"
}
```

Example review payload:

```json
{ "status": "Approved" }
```

Common status codes:

| Code | Meaning |
| --- | --- |
| `200` | Successful read or update |
| `201` | Created account, item, or request |
| `400` | Validation failure or insufficient stock |
| `401` | Authentication required / invalid credentials |
| `403` | Role check failed or account locked |
| `404` | Record or static file not found |
| `409` | Duplicate code/email or already-reviewed request |
| `413` | Request body exceeds 1 MB |
| `500` | Unexpected server error |

Lockout behavior: the first two failed logins return `401` with the remaining
attempt count. The third failed login locks the account, writes a
`Security Alert: Account Locked` audit entry, and returns `403` with the message
`Account is locked due to multiple failed login attempts. Please contact an
Administrator.`

Approval concurrency: the request row and inventory row are selected with
`FOR UPDATE` in one transaction. If available stock is less than the requested
quantity, the API returns `400 Insufficient stock available` and no changes are
committed. Non-pending requests return `409`.

Audit actions recorded by the API:

- `Initial Record`
- `User Registered`
- `Security Alert: Account Locked`
- `User Login`
- `Item Created`
- `Record Edited`
- `Item Deleted`
- `Supply Requested`
- `Request Approved`
- `Request Rejected`

## Validation

Useful checks during development:

```bash
python -m py_compile app.py config.py db.py auth_utils.py seed_from_excel.py
node --check app.js
for file in js/*.js; do node --check "$file"; done
```

Also confirm that no legacy patterns reappear:

```bash
grep -RInE '\blocalStorage\b|\bvar\b|on(click|change|submit|input)=' --include='*.html' --include='*.js' .
```


## Docker deployment

The production image runs Nginx on port 80 and proxies requests to the Flask
application served by Gunicorn on the container's loopback interface. The
database is external to this container.

1. Install Docker Engine and the Docker Compose plugin on the server.
2. Copy `.env.example` to `.env`. Set a strong `SECRET_KEY`, production
   database settings (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) or
   `MYSQL_URL`, and `SESSION_COOKIE_SECURE=true` when serving the site over
   HTTPS. The database host must be reachable from the Docker container.
3. Start the service:

   ```bash
   docker compose up -d --build
   ```

The service listens on port 80 by default; set `HTTP_PORT` in `.env` to change
the host port. Use `docker compose logs -f web` to follow startup and database
bootstrap logs. `deploy/prepare_db.py` applies the schema and seed data each
time the container starts.

Configure TLS and firewall access for the server before exposing the app
publicly. The container's Nginx listener is HTTP; terminate HTTPS at a
TLS-enabled reverse proxy or configure certificates for Nginx, and keep
`SESSION_COOKIE_SECURE=true` when the public site uses HTTPS.