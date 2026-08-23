"""Shared A2A protocol support.

Named `a2a_support` rather than `a2a` so that `from a2a.types import ...`
inside these modules keeps resolving to the installed SDK. A sibling package
named `a2a` would read as a shadow to anyone skimming the imports, even though
Python 3's absolute imports would resolve it correctly.
"""
