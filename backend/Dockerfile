# Laravel API image. The same image runs the web server (default), the scheduler and the setup job;
# see docker-compose.yml in the repository root.

FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
# Extensions are installed in the runtime image below, so skip the check in this build-only stage.
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-scripts

FROM php:8.3-apache-bookworm
RUN docker-php-ext-install pdo_mysql bcmath opcache \
    && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && a2enmod rewrite
COPY docker/php.ini "$PHP_INI_DIR/conf.d/zz-smsflow.ini"
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf

WORKDIR /var/www/html
COPY --from=vendor /app ./
# Needs no database or secrets. Configuration is not cached, because it comes from the container's environment.
RUN CACHE_STORE=array php artisan package:discover --no-ansi \
    && mkdir -p storage/app/private storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD php -r "exit(@file_get_contents('http://127.0.0.1/api/v1/health') === false ? 1 : 0);"
