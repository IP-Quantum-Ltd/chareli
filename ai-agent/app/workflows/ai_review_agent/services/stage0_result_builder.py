from app.domain.dto import Stage0Investigation


class Stage0ResultBuilder:
    def failed(self, reason: str, **kwargs):
        return Stage0Investigation(status="failed", reason=reason, **kwargs).to_dict()

    def success(self, **kwargs):
        return Stage0Investigation(status="success", **kwargs).to_dict()
