#!/usr/bin/env python
# -*- coding: utf-8 -*-
# pylint: disable=C0111,W6005,W6100
from __future__ import absolute_import, print_function

import os

from setuptools import setup

README = open(os.path.join(os.path.dirname(__file__), 'README.md')).read()

setup(
    name='edx-proctoring-proctortrack-v2',
    description='Proctoring subsystem for edX-proctoring',
    long_description=README,
    author='pt-developer',
    author_email='developer@verificient.com',
    url='https://github.com/verificient/edx-proctoring-proctortrack',
    license="Apache-2.0",
    keywords='Proctortrack edx',
    version='2.0.0',
    python_requires='>=3.11',
    packages=[
        'edx_proctoring_proctortrack',
    ],
    include_package_data=True,
    install_requires=[
        'edx_proctoring',
    ],
    entry_points={
        'openedx.proctoring': [
            'proctortrack = edx_proctoring_proctortrack.backends.proctortrack_rest:ProctortrackBackendProvider',
        ],
    },
    classifiers=[
        'Framework :: Django',
        'Intended Audience :: Education',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.11',
        'Programming Language :: Python :: 3.12',
        'Topic :: Education',
    ],
)
