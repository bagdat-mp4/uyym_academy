# Проверка этапа 1

Дата: 10 октября 2026. Проверялся код локально на Windows / Node.js 22.22.0. Это отчёт о POC-коде, не приёмка реального Supabase/Google Drive.

## Автоматические результаты

`npm run build`: TypeScript без ошибок, Vite production bundle создан. `npm test`: **28/28 PASS** (12 SQL + 12 API + 4 криптография/доступ). `npm audit --omit=dev` после удаления `@fastify/static`: 0 известных production advisories по ответу npm на дату проверки; это не гарантия отсутствия неизвестных уязвимостей.

SQL-тесты выполняют все три миграции и PL/pgSQL на настоящем embedded PostgreSQL PGlite. Проверяются FORCE RLS, отсутствие browser grants/RPC, restrictive private Storage против permissive policy, уникальность привязки/сессии, сохранение ключа после logout/reset, замена с epoch/revocation, одноразовый challenge, expiry, append-only журнал и серверная роль. Системные Auth/Storage таблицы и роли созданы локально минимальными fixtures; это не проверка конфигурации живого Supabase.

API-тесты выполняют реальные маршруты Fastify через `app.inject`, с этими миграциями в PostgreSQL и настоящими неэкспортируемыми Web Crypto P-256 ключами. Проверены setup/pending, активирование по proof, cookie без подписи и чужой ключ, второй браузер без вытеснения, replay/endpoint/body transfer, CSRF/Origin, истечение/чужой курс, постоянный phone limiter, ADMIN TOTP/replay, замена через admin endpoint, TEACHER scope и запрет admin API. Playback manifest скрывает Drive IDs; grant нельзя перенести ученику или другому уроку. После pause/revoke heartbeat/media admission отклоняются до обращения к Drive.

Только внешние ответы Supabase Auth token/password REST **симулируются** в API-тестах. Успешный ответ видео от Drive не симулировался и не выдаётся за проверенный. Embedded PostgreSQL имеет один connection: настоящие гонки нескольких SQL connections и физические устройства требуют отдельного теста.

Криптографические тесты: raw IEEE-P1363 Web Crypto signature проверяется Node crypto, подмена пути/сессии/purpose/nonce/body и другого ключа отклоняется; export private key невозможен; malformed/private supplied JWK отклоняется; RFC6238 TOTP vector и повтор counter; AES-GCM corruption; границы enrollment и максимальная часть 1 MiB.

## Интерфейс

Локальный предпросмотр в Codex in-app browser: главная KZ/RU, переключение языка, мобильное расположение, форма входа и модальное окно курса без настроенных контактов проверены визуально. Контакты и преподаватели не выдуманы; запись/WhatsApp не подменены успешной отправкой. По DOM на мобильном размере scrollWidth не превышал viewport. Это проверка интерфейса в Chromium-предпросмотре; она не доказывает совместимость видеопотока с Chrome/Edge/Android/Safari.

Собранная версия отдельно запущена через `npm start` и проверена HTTP: `/`, JS asset и `/brand.png` возвращают 200; `/.env` — 404; приватный `/api/lessons` без подключённых сервисов — 503. `/api/health` честно показывает `configured:false`, `drive_configured:false`. Финальное повторное открытие production-предпросмотра в браузере было заблокировано политикой браузерного инструмента; его визуальная проверка не заявляется. Это не отменяет ранее проверенный dev-интерфейс и HTTP smoke check.

MSE использует JavaScript fetch с proof на каждом фрагменте. Для iPhone добавлена ветка ManagedMediaSource с disableRemotePlayback, сигналами startstreaming/endstreaming и теми же подписями. Основание — [официальная документация WebKit](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/). Реальный Safari/codec/storage key persistence остаются **непроверенными**. Fullscreen раскрывает wrapper с watermark; при недоступном Fullscreen API показывается расширение до окна с явным уведомлением.

## Что не проверено и не закончено

- Внешние Auth/Admin API, регистрация сервиса, public signup prohibition и Data API/RPC/Storage на реальном Supabase.
- Restricted Google ACL, service-account sharing, реальные `files.get?alt=media` ответы 206 и поток/квоты.
- FFmpeg preprocessing реальной записи (FFmpeg не установлен в этой среде), MIME/codec каждой части, успешное воспроизведение и seek.
- Chrome и Edge на ноутбуке, Android и Safari iPhone с реальным видео; замена/очистка/перезапуск/IP change на физических устройствах.
- Конкурентные транзакции нескольких connections, отзыв во время реальной передачи, нагрузка 30 пользователей, измеренный bandwidth/счёт.
- Полная учебная платформа: домашние задания/оценки/файлы/расписание/посещаемость/прогресс и полная админка пока в следующем этапе; в POC есть только их модель данных.
- Внешний HTTPS deployment, домен, резервный backup/restore и восстановление Auth идентичностей.

Полный список ожидаемых результатов и статусов находится в `poc-acceptance.md`. Перед началом полной LMS нужен успешный сценарий с одним реальным приватным видео. Секреты не входят в исходники и клиентский build; в репозитории только `.env.example`.
