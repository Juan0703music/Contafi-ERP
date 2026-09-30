# ARQUITECTURA TÉCNICA DE PROMPT Y SISTEMA: ERP FINANCIERO-CONTABLE INTEGRAL

## 1. RESUMEN EXECUTIVO Y OBJETIVOS DE DISEÑO
El ERP Financiero-Contable Corporativo está diseñado bajo una arquitectura modular **API-First**, de alta disponibilidad, escalabilidad horizontal y cumplimiento normativo colombiano (DIAN, NIIF, UGPP).

### Principios del Sistema
- **Partida Doble Invariable**: Ninguna transacción modifica saldos sin generar un asiento contable validado $\sum \text{Débitos} = \sum \text{Créditos}$.
- **Arquitectura Event-Driven (EDA)**: Los eventos operacionales (Ventas, Compras, Nómina) disparan automáticamente asientos contables y afectaciones de tesorería e inventarios en tiempo real.
- **Trazabilidad Absoluta y Cero Borrado**: Estrategia *Soft Delete* con tablas de auditoría inmutables (`audit_logs`) e historial delta por registro.
- **Multitenancy Aislado**: Soporte Multi-empresa, Multi-sucursal y Multi-moneda con control de acceso basado en roles (RBAC) y atributos (ABAC).

---

## 2. STACK TECNOLÓGICO RECOMENDADO

### Backend
- **Lenguaje/Framework**: Node.js (NestJS / TypeScript) o Go / Python (FastAPI) para microservicios de alto rendimiento.
- **Motor de Transacciones**: Worker Queues con Redis / BullMQ para procesamiento asíncrono de facturación masiva y cierres contables.

### Frontend
- **Framework**: React.js con Next.js (SSR/SSG), TypeScript y Tailwind CSS.
- **Gestión de Estado**: TanStack Query (React Query) + Zustand.

### Base de Datos & Caché
- **Base de Datos Principal**: PostgreSQL 15+ (Garantía ACID, Partitioning por Empresa/Año Fiscal, JSONB para parametrización flexible).
- **Caché y Mensajería**: Redis (Sesiones, Rate Limiting, Caché de Reportes).

### Infraestructura y DevOps
- **Contenedores**: Docker & Kubernetes / Docker Compose.
- **Seguridad**: OAuth2 / OpenID Connect + JWT (RS256), Vault para secretos, TLS 1.3.
- **Almacenamiento de Archivos**: AWS S3 / MinIO (Soportes, adjuntos, facturas XML/PDF).

---

## 3. DIAGRAMA DE ARQUITECTURA DE MÓDULOS

```
                                  ┌───────────────────────────────┐
                                  │      CLIENTES FRONTEND        │
                                  │  (Web, Tablet, Mobile Apps)   │
                                  └──────────────┬────────────────┘
                                                 │ HTTPS / WSS
                                  ┌──────────────┴────────────────┐
                                  │    API GATEWAY / INGRESS      │
                                  │ (Rate Limiting, Auth, Routes) │
                                  └──────────────┬────────────────┘
                                                 │
          ┌──────────────────────────────────────┼──────────────────────────────────────┐
          │                                      │                                      │
┌─────────┴──────────┐                ┌──────────┴───────────┐                ┌─────────┴──────────┐
│ SERVICIO DE AUTH   │                │ CORE CONTABLE        │                │ MOTOR DE IA &      │
│  & PERMISOS (RBAC) │                │ (Partida Doble, PUC) │                │ ANALÍTICA          │
└─────────┬──────────┘                └──────────┬───────────┘                └─────────┬──────────┘
          │                                      │                                      │
          └──────────────────┬───────────────────┴───────────────────┬──────────────────┘
                             │           EVENT BUS (Redis / NATS)    │
                             │                                       │
     ┌───────────────────────┼───────────────────────┬───────────────┴───────────────┐
     │                       │                       │                               │
┌────┴──────────────┐ ┌──────┴─────────────┐ ┌───────┴─────────────┐ ┌───────────────┴─────────────┐
│ MODULO OPERATIVO  │ │ MODULO FINANCIERO │ │ MODULO LOGÍSTICO    │ │ MOTOR TRIBUTARIO           │
│ - Ventas/Cartera  │ │ - Tesorería       │ │ - Inventarios/Kardex│ │ - Impuestos / Retenciones  │
│ - Compras/CXP     │ │ - Conciliación    │ │ - Activos Fijos     │ │ - Facturación Electrónica  │
│ - Nómina          │ │ - Flujo de Caja   │ │ - Presupuestos      │ │ - DIAN / PILA              │
└────┬──────────────┘ └──────┬────────────┘ └───────┬─────────────┘ └───────────────┬─────────────┘
     │                       │                       │                               │
     └───────────────────────┴───────────────────────┼───────────────────────────────┘
                                                     │
                                      ┌──────────────┴──────────────┐
                                      │ BASE DE DATOS POSTGRESQL    │
                                      │ (Schemas / RLS por Empresa) │
                                      └─────────────────────────────┘
```

---

## 4. MODELO ENTIDAD-RELACIÓN Y TABLAS PRINCIPALES (DDL ESQUEMA)

### 4.1. Core Empresarial y Estructura
- **`companies`**: ID, NIT, Razón Social, Régimen, Representante Legal, Moneda Base.
- **`branches`**: ID, Company_ID, Nombre, Código, Dirección, Ciudad.
- **`cost_centers`**: ID, Company_ID, Código, Nombre, Padre_ID.
- **`projects`**: ID, Company_ID, Nombre, Presupuesto, Estado.

### 4.2. Contabilidad Núcleo
- **`accounts` (PUC)**:
  - `id` (UUID), `company_id` (FK), `code` (VARCHAR), `name` (VARCHAR), `level` (INT), `nature` (DEBIT/CREDIT), `requires_third_party` (BOOL), `requires_cost_center` (BOOL), `is_active` (BOOL).
- **`accounting_entries` (Comprobantes Header)**:
  - `id` (UUID), `company_id` (FK), `branch_id` (FK), `voucher_type` (VARCHAR), `number` (VARCHAR), `date` (DATE), `concept` (TEXT), `status` (DRAFT/POSTED/ANNULLED), `created_by` (FK).
- **`accounting_entry_lines` (Detalle de Asiento)**:
  - `id` (UUID), `entry_id` (FK), `account_id` (FK), `third_party_id` (FK, Nullable), `cost_center_id` (FK, Nullable), `project_id` (FK, Nullable), `debit` (NUMERIC 18,2), `credit` (NUMERIC 18,2), `base_amount` (NUMERIC 18,2).

### 4.3. Operaciones & Inventarios
- **`third_parties`**: ID, Company_ID, Identification_Type, Document_Number, Name, Type (CLIENT/SUPPLIER/EMPLOYEE), Tax_Details.
- **`invoices`**: ID, Company_ID, Branch_ID, Third_Party_ID, Number, Total_Amount, Tax_Amount, Status, CUFE, XML_Url.
- **`invoice_items`**: ID, Invoice_ID, Product_ID, Quantity, Unit_Price, Total, Account_ID.
- **`products`**: ID, SKU, Name, Type (PRODUCT/SERVICE), Inventory_Account_ID, Cost_Account_ID, Revenue_Account_ID.
- **`inventory_movements`**: ID, Product_ID, Warehouse_ID, Type (IN/OUT), Quantity, Unit_Cost, Accounting_Entry_ID.

---

## 5. FLUJO COMPLETO DE INTEGRACIÓN CONTABLE

### Ejemplo 1: Flujo de Venta a Crédito e Inventario
1. **Acción del Usuario**: Emisión de Factura de Venta por \$1,190,000 (Base \$1,000,000 + IVA 19% \$190,000). Costo de inventario asignado: \$600,000.
2. **Validación**:
   - Período contable abierto.
   - Numeración/Resolución vigente.
   - Verificación de Saldo en Inventario.
3. **Disparo Evento**: `InvoiceCreatedEvent`.
4. **Asiento Contable Generado Automáticamente**:
   - **Débito**: $1,190,000 \rightarrow$ Cuenta $1305$ (Clientes Nacionales / Tercero: Cliente X)
   - **Crédito**: $190,000 \rightarrow$ Cuenta $2408$ (IVA Generado 19%)
   - **Crédito**: $1,000,000 \rightarrow$ Cuenta $4135$ (Ingresos Comercio)
   - **Débito**: $600,000 \rightarrow$ Cuenta $6135$ (Costo de Ventas)
   - **Crédito**: $600,000 \rightarrow$ Cuenta $1435$ (Inventario de Mercancías)
5. **Afectación de Módulos**:
   - Módulo de Cartera: Registra CXP pendiente de \$1,190,000 con vencimiento a N días.
   - Módulo Kardex: Salida física e histórica de mercancía por valor de \$600,000.

---

## 6. MATRIZ DE ROLES Y PERMISOS (RBAC)

| Rol | Contabilidad | Ventas / CXC | Compras / CXP | Tesorería | Nómina | Cierres | Auditoría / Logs |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **SuperAdmin** | Full | Full | Full | Full | Full | Full | Full |
| **Contador** | Crear/Aprobar | Leer/Crear | Leer/Crear | Leer/Aprobar | Leer/Contabilizar | Ejecutar | Leer |
| **Aux. Contable** | Crear Borrador | Leer/Crear | Leer/Crear | Solo Leer | No Access | No | No |
| **Tesorero** | Solo Leer | Leer Registros | Leer Registros | Crear/Ejecutar | Leer Pagos | No | No |
| **Gerente** | Consultar | Consultar | Consultar | Consultar | Consultar | No | Leer |
| **Auditor** | Solo Lectura | Solo Lectura | Solo Lectura | Solo Lectura | Solo Lectura | No | Full Lectura |

---

## 7. ESTRUCTURA DE CARPETAS DEL PROYECTO

```
erp-enterprise/
├── docker-compose.yml
├── README.md
├── docs/
│   ├── architecture/
│   └── api-spec/
├── apps/
│   ├── api-gateway/
│   ├── backend-core/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── common/             # Interceptors, Filters, Guards
│   │   │   ├── database/           # Migrations, Seeds, Entities
│   │   │   └── modules/
│   │   │       ├── auth/           # RBAC, OAuth2, Session
│   │   │       ├── company/        # Multi-company, Branches
│   │   │       ├── accounting/     # PUC, Ledger, Double-Entry Engine
│   │   │       ├── third-party/    # Clients, Suppliers, Employees
│   │   │       ├── sales/          # Invoices, Receivables
│   │   │       ├── purchases/      # Payables, Orders
│   │   │       ├── inventory/      # Warehouses, Kardex
│   │   │       ├── treasury/       # Banking, Reconciliations
│   │   │       ├── taxes/          # Tax Engine (IVA, RETE, ICA)
│   │   │       ├── payroll/        # NE, PILA, Concepts
│   │   │       ├── audit/          # Immutable Audit Trail
│   │   │       └── ai-assistant/   # Financial Query Engine
│   └── frontend-web/
│       ├── public/
│       ├── src/
│       │   ├── components/         # UI Elements, Tables, Forms
│       │   ├── hooks/
│       │   ├── layouts/            # Sidebar, Header, Breadcrumbs
│       │   ├── pages/              # Dashboards, Modules Views
│       │   ├── services/           # API Clients (Axios/Fetch)
│       │   └── store/              # Global State
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## 8. PLAN DE IMPLEMENTACIÓN POR FASES (ROADMAP)

### FASE 1: Núcleo y Fundamentos
- Configuración de la Base de Datos, Docker e Infraestructura.
- Autenticación segura (JWT/MFA), Sistema RBAC, Configuración Multi-Empresa.
- Módulo de Terceros y Plan Único de Cuentas (PUC).

### FASE 2: Motor Contable Inalterable
- Motor de Asientos de Partida Doble (Validación $\text{Débito} = \text{Crédito}$).
- Gestión de Comprobantes, Libros Auxiliares, Diario, Mayor y Balances.
- Control de Períodos Contables.

### FASE 3: Módulos Operativos (Ventas, Compras e Inventarios)
- Facturación y Gestión de Cartera (CXP/CXC).
- Compras, Proveedores y Kardex de Inventarios.
- Integración automática con el Motor Contable.

### FASE 4: Tesorería y Finanzas
- Bancos, Cajas, Conciliaciones Bancarias automáticas/manuales.
- Flujo de Caja (Histórico/Proyectado) y Presupuestos.

### FASE 5: Motor Tributario y Cumplimiento Normativo (Colombia)
- Retenciones (Fuente, IVA, ICA), Impuestos Parametrizables.
- Preparación e Integración de Facturación y Nómina Electrónica.

### FASE 6: Activos Fijos, Nómina y Cierres
- Depreciación automática de Activos Fijos.
- Nómina y Prestaciones Sociales.
- Cierres Contables Mensuales/Anuales con Validación Estricta.

### FASE 7: Inteligencia Financiera, Audit Trail y Producción
- Dashboard Gerencial y Asistente IA Financiero.
- Registro completo de auditoría, Pruebas de Carga/E2E, Hardening de Seguridad.