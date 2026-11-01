# Foto Șantier – același server PHP ca pe hosting (cPanel), gata de pus pe un VPS.
FROM php:8.3-apache

# Apache: .htaccess activ (rutare api/ și files/), compresie și cache. PHP: opcache + limite pentru poze.
RUN a2enmod rewrite headers deflate \
 && sed -ri 's#AllowOverride None#AllowOverride All#' /etc/apache2/apache2.conf \
 && docker-php-ext-enable opcache \
 && { echo 'opcache.enable=1'; echo 'opcache.memory_consumption=64'; echo 'opcache.validate_timestamps=0'; \
      echo 'post_max_size=32M'; echo 'upload_max_filesize=32M'; echo 'max_execution_time=120'; echo 'expose_php=Off'; } \
      > /usr/local/etc/php/conf.d/foto.ini \
 && echo 'ServerTokens Prod' >> /etc/apache2/conf-enabled/security.conf \
 && mkdir -p /data && chown www-data:www-data /data

COPY public/ /var/www/html/
COPY php/api.php php/.htaccess /var/www/html/

# Datele (baza de date + pozele) stau în afara folderului web, într-un volum.
ENV DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 80
