"""Canonical IST timezone constant for the entire NAICEWS pipeline.

Import this instead of using datetime.now() or datetime.utcnow() anywhere,
so that all slot alignment is consistent regardless of the runner's system clock.
"""
from datetime import timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
