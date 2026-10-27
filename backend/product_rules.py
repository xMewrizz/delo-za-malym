"""Fingerprint the actual product rules used for saved preliminary comparisons."""
from dataclasses import asdict
from hashlib import sha256
import json

from credit_engine.assessment import WorkingCapitalPolicy
from credit_engine.overdraft_assessment import OverdraftCreditPolicy
from credit_engine.refinancing import POLICY as REFINANCING
from credit_engine.revolving import POLICY as REVOLVING
from credit_engine.investment import POLICY as INVESTMENT, MINIMUM_OWN_SHARE


def product_fingerprint(product):
    policy={"working_capital_loan":WorkingCapitalPolicy(),"overdraft":OverdraftCreditPolicy(),
            "refinancing":REFINANCING,"revolving_credit_line":REVOLVING,"investment_loan":INVESTMENT}[product]
    values=asdict(policy)
    if product=="investment_loan":
        values["minimum_own_share"]=MINIMUM_OWN_SHARE
    if product=="overdraft":
        values["existing_loan_funding"]="own-funds-only-v1"
    return sha256(json.dumps(values,sort_keys=True,default=str).encode()).hexdigest()[:20]
