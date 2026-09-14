# Smart Student Performance Monitoring System

The detailed product context for this repository is maintained from the supplied project brief. The implementation follows these confirmed decisions:

- React web client
- Python FastAPI backend
- SQLite during the current development phase; PostgreSQL remains a later production option
- Student and Teacher roles only
- One backend API shared by web and future mobile clients
- Server-side authorization and explainable analytics

The supplied backlog workbook currently contains 8 stories, not 56. It also includes requirements that conflict with the brief (Project Manager role, report export, email notifications, and fixed thresholds). Those items are not treated as confirmed scope.

## Implemented slice

- Role-aware demo login for a student and teacher
- Student dashboard with GPA, attendance, course grades, alerts, recommendations, and trends
- Semester-scoped grade breakdown
- Teacher dashboard with authorized student list, explainable risk factors, and attendance/performance correlation
- Explicit missing-data handling
- API tests for authentication, ownership, teacher scope, and core analytics
