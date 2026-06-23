# Do things in edx-proctoring-proctortrack

.PHONY: extract_translations compile_translations

extract_translations: ## extract localizable strings from sources
	pybabel extract -F edx_proctoring_proctortrack/conf/locale/babel_django.cfg \
		-c "Translators:" \
		--project=edx-proctoring-proctortrack \
		--copyright-holder=edX \
		-o edx_proctoring_proctortrack/conf/locale/en/LC_MESSAGES/django.po \
		edx_proctoring_proctortrack

compile_translations: ## compile translation files, used for development
	django-admin compilemessages --locale en
